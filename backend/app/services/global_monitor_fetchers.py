"""
Global Monitor Data Ingestion Services
Fetch data from external APIs with circuit breakers and rate limiting
"""
import asyncio
import httpx
import time
import redis.asyncio as redis
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum
import hashlib
import json

from app.config import settings


class CircuitState(Enum):
    CLOSED = "closed"  # Normal operation
    OPEN = "open"      # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing recovery


class CircuitBreaker:
    """
    Circuit breaker pattern for API resilience
    Prevents cascading failures from external API issues
    """
    def __init__(
        self, 
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        half_open_max_calls: int = 3
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        
        self.failure_count = 0
        self.last_failure_time = None
        self.state = CircuitState.CLOSED
        self.half_open_calls = 0
    
    def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection"""
        if self.state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self.state = CircuitState.HALF_OPEN
                self.half_open_calls = 0
            else:
                raise Exception("Circuit breaker is OPEN - service unavailable")
        
        if self.state == CircuitState.HALF_OPEN:
            if self.half_open_calls >= self.half_open_max_calls:
                raise Exception("Circuit breaker HALF_OPEN limit reached")
            self.half_open_calls += 1
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise e
    
    def _on_success(self):
        """Handle successful call"""
        if self.state == CircuitState.HALF_OPEN:
            self.state = CircuitState.CLOSED
            self.failure_count = 0
        self.failure_count = 0
    
    def _on_failure(self):
        """Handle failed call"""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to try recovery"""
        if self.last_failure_time is None:
            return False
        return (time.time() - self.last_failure_time) >= self.recovery_timeout


class RateLimiter:
    """Simple rate limiter with token bucket algorithm"""
    def __init__(self, calls_per_second: float = 10):
        self.calls_per_second = calls_per_second
        self.tokens = calls_per_second
        self.last_update = time.time()
    
    async def acquire(self):
        """Wait until a token is available"""
        while True:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(
                self.calls_per_second,
                self.tokens + elapsed * self.calls_per_second
            )
            self.last_update = now
            
            if self.tokens >= 1:
                self.tokens -= 1
                return
            
            # Wait for next token
            wait_time = (1 - self.tokens) / self.calls_per_second
            await asyncio.sleep(wait_time)


class BaseDataFetcher:
    """Base class for all data fetchers"""
    
    def __init__(self):
        self.circuit_breaker = CircuitBreaker()
        self.rate_limiter = RateLimiter(calls_per_second=5)  # Conservative default
        self.client = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=30.0,
                follow_redirects=True,
                headers={"User-Agent": "QuantTrade-AI/1.0"}
            )
        return self.client
    
    async def close(self):
        """Close HTTP client"""
        if self.client:
            await self.client.aclose()
            self.client = None
    
    async def fetch_with_retry(
        self, 
        url: str, 
        params: Optional[Dict] = None,
        headers: Optional[Dict] = None,
        method: str = "GET",
        data: Optional[Dict] = None,
        max_retries: int = 3,
        backoff_factor: float = 2.0
    ) -> Dict:
        """Fetch data with exponential backoff retry"""
        client = await self._get_client()
        
        for attempt in range(max_retries):
            try:
                await self.rate_limiter.acquire()
                
                response = await client.request(method, url, params=params, headers=headers, data=data)
                response.raise_for_status()
                return response.json()
                
            except Exception as e:
                if attempt == max_retries - 1:
                    raise e
                
                wait_time = backoff_factor ** attempt
                await asyncio.sleep(wait_time)
        
        raise Exception(f"Failed after {max_retries} attempts")
    
    @staticmethod
    def generate_event_id(source: str, raw_data: Dict) -> str:
        """Generate consistent event ID from source data"""
        # Create a hash of key fields to ensure uniqueness
        data_str = json.dumps(raw_data, sort_keys=True)
        hash_obj = hashlib.md5(data_str.encode())
        return f"{source}_{hash_obj.hexdigest()[:16]}"


class GDELTFetcher(BaseDataFetcher):
    """
    Fetch data from GDELT (Global Database of Events, Language, and Tone)
    Real-time global news and event monitoring
    """
    
    BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
    
    async def fetch_events(
        self,
        query: str = "",
        timespan: str = "1h",  # Last hour
        max_records: int = 250
    ) -> List[Dict]:
        """
        Fetch recent events from GDELT
        
        Args:
            query: Search query (keywords, topics)
            timespan: Time window (1h, 6h, 24h, etc.)
            max_records: Maximum results to return
        """
        params = {
            "query": query or "(conflict OR war OR attack OR disaster OR earthquake)",
            "mode": "ArtList",
            "maxrecords": max_records,
            "timespan": timespan,
            "format": "json"
        }
        
        try:
            data = await self.fetch_with_retry(self.BASE_URL, params)
            return self._parse_gdelt_response(data)
        except Exception as e:
            print(f"GDELT fetch error: {e}")
            return []
    
    def _parse_gdelt_response(self, data: Dict) -> List[Dict]:
        """Parse GDELT API response into standardized format"""
        events = []
        
        articles = data.get("articles", [])
        for article in articles:
            # Extract location (GDELT provides geocoding)
            locations = article.get("locations", [])
            if not locations:
                continue
            
            primary_loc = locations[0]
            
            event = {
                "source": "gdelt",
                "title": article.get("title", ""),
                "description": article.get("seendate", ""),
                "url": article.get("url", ""),
                "latitude": primary_loc.get("lat", 0),
                "longitude": primary_loc.get("lon", 0),
                "location_name": primary_loc.get("name", ""),
                "country_code": primary_loc.get("countrycode", ""),
                "event_timestamp": article.get("seendate", datetime.utcnow().isoformat()),
                "sentiment_score": article.get("tone", {}).get("tone", 0),
                "raw_data": article
            }
            events.append(event)
        
        return events


class ACLEDFetcher(BaseDataFetcher):
    """
    Fetch data from ACLED (Armed Conflict Location & Event Data Project)
    Real-time conflict and crisis monitoring
    """
    
    BASE_URL = "https://acleddata.com/api/acled/read"
    AUTH_URL = "https://acleddata.com/oauth/token"
    
    def __init__(self):
        super().__init__()
        # ACLED requires authentication (get free key at acleddata.com)
        self.api_key = settings.ACLED_API_KEY if hasattr(settings, 'ACLED_API_KEY') else None
        self.email = settings.ACLED_EMAIL if hasattr(settings, 'ACLED_EMAIL') else None
        self.password = settings.ACLED_PASSWORD if hasattr(settings, 'ACLED_PASSWORD') else None
        self.redis_client = None

    async def _get_redis(self):
        if not self.redis_client:
            redis_url = getattr(settings, "REDIS_URL", "redis://localhost:6379")
            self.redis_client = redis.from_url(redis_url, decode_responses=True)
        return self.redis_client

    async def _get_access_token(self) -> Optional[str]:
        """Get OAuth token, check cache first"""
        if not self.email or not self.password:
            return None

        try:
            r = await self._get_redis()
            token_key = f"acled_token:{self.email}"
            
            # 1. Check Redis cache
            cached_token = await r.get(token_key)
            if cached_token:
                return cached_token

            # 2. Authenticate
            payload = {
                "username": self.email,
                "password": self.password,
                "grant_type": "password",
                "client_id": "acled"
            }
            # Use fetch_with_retry for resilience, but it's a POST
            # We can use the parent client directly or use httpx if retry logic is complex
            # Let's use fetch_with_retry which we updated to support POST
            response = await self.fetch_with_retry(
                self.AUTH_URL, 
                method="POST", 
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            
            access_token = response.get("access_token")
            expires_in = response.get("expires_in", 86400) # Default 1 day
            
            if access_token:
                # Cache for expires_in - 60 seconds (safety buffer)
                await r.setex(token_key, int(expires_in) - 60, access_token)
                return access_token
                
        except Exception as e:
            print(f"ACLED Auth Failed: {e}")
            return None
        return None

    async def fetch_conflicts(
        self,
        event_date: Optional[str] = None,
        event_date_where: str = "BETWEEN",
        limit: int = 500
    ) -> List[Dict]:
        """
        Fetch recent conflict events
        
        Args:
            event_date: Date or date range (YYYY-MM-DD)
            event_date_where: Query operator (BETWEEN, >, <, =)
            limit: Maximum records
        """
        token = await self._get_access_token()
        
        if not token and not self.api_key:
             print("ACLED Credentials missing (Email+Password or API Key)")
             return []

        # Default to last 7 days
        if not event_date:
            today = datetime.utcnow()
            week_ago = today - timedelta(days=7)
            event_date = f"{week_ago.strftime('%Y-%m-%d')}|{today.strftime('%Y-%m-%d')}"
        
        params = {
            "event_date": event_date,
            "event_date_where": event_date_where,
            "limit": limit,
            "format": "json"
        }
        
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        elif self.email and self.api_key:
            # Fallback to legacy
            params["key"] = self.api_key
            params["email"] = self.email
        
        try:
            data = await self.fetch_with_retry(self.BASE_URL, params=params, headers=headers)
            return self._parse_acled_response(data)
        except Exception as e:
            print(f"ACLED fetch error: {e}")
            # Try clearing token if auth failed (401/403 would be raised by raise_for_status)
            if "nb_err_auth" in str(e) or "401" in str(e) or "403" in str(e):
                r = await self._get_redis()
                await r.delete(f"acled_token:{self.email}")
                print("ACLED Token invalidated, will retry next run")
            return []
    
    def _parse_acled_response(self, data: Dict) -> List[Dict]:
        """Parse ACLED response into standardized format"""
        events = []
        
        for item in data.get("data", []):
            # Calculate severity based on fatalities
            fatalities = int(item.get("fatalities", 0))
            severity = min(100, fatalities * 10)  # Cap at 100
            
            event = {
                "source": "acled",
                "title": item.get("event_type", "Conflict Event"),
                "description": item.get("notes", ""),
                "latitude": float(item.get("latitude", 0)),
                "longitude": float(item.get("longitude", 0)),
                "location_name": item.get("location", ""),
                "country_code": item.get("iso", ""),
                "event_timestamp": item.get("event_date", ""),
                "severity": severity,
                "estimated_casualties": fatalities,
                "raw_data": item,
                "category": "conflict"
            }
            events.append(event)
        
        return events


class USGSFetcher(BaseDataFetcher):
    """
    Fetch earthquake data from USGS (United States Geological Survey)
    Real-time seismic activity monitoring
    """
    
    BASE_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
    
    async def fetch_earthquakes(
        self,
        min_magnitude: float = 4.0,
        timespan_hours: int = 24,
        limit: int = 100
    ) -> List[Dict]:
        """
        Fetch recent earthquakes
        
        Args:
            min_magnitude: Minimum magnitude threshold
            timespan_hours: How far back to look
            limit: Maximum results
        """
        start_time = datetime.utcnow() - timedelta(hours=timespan_hours)
        
        params = {
            "format": "geojson",
            "starttime": start_time.strftime("%Y-%m-%dT%H:%M:%S"),
            "minmagnitude": min_magnitude,
            "orderby": "time",
            "limit": limit
        }
        
        try:
            data = await self.fetch_with_retry(self.BASE_URL, params)
            return self._parse_usgs_response(data)
        except Exception as e:
            print(f"USGS fetch error: {e}")
            return []
    
    def _parse_usgs_response(self, data: Dict) -> List[Dict]:
        """Parse USGS GeoJSON response"""
        events = []
        
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            coords = feature.get("geometry", {}).get("coordinates", [0, 0, 0])
            
            magnitude = props.get("mag", 0)
            # Severity scale: 4-5 = LOW, 5-6 = MEDIUM, 6-7 = HIGH, 7+ = CRITICAL
            severity = min(100, (magnitude - 4) * 25)
            
            event = {
                "source": "usgs",
                "title": f"M{magnitude} Earthquake - {props.get('place', 'Unknown')}",
                "description": props.get("title", ""),
                "latitude": coords[1],
                "longitude": coords[0],
                "location_name": props.get("place", ""),
                "event_timestamp": datetime.fromtimestamp(props.get("time", 0) / 1000).isoformat(),
                "severity": severity,
                "raw_data": feature,
                "category": "disaster"
            }
            events.append(event)
        
        return events


class OpenSkyFetcher(BaseDataFetcher):
    """
    Fetch flight data from OpenSky Network
    Real-time aviation tracking for anomaly detection
    """
    
    BASE_URL = "https://opensky-network.org/api"
    
    def __init__(self):
        super().__init__()
        self.username = settings.OPENSKY_USERNAME
        self.password = settings.OPENSKY_PASSWORD
        
        # Rate limits: 
        # Anonymous: 400 credits per day (~100 req/day conservative)
        # Authenticated: 4000 credits per day (~1000 req/day)
        cps = 2.0 if self.username and self.password else 0.5
        self.rate_limiter = RateLimiter(calls_per_second=cps)
    
    async def fetch_flights(
        self,
        bbox: Optional[tuple] = None  # (lat_min, lon_min, lat_max, lon_max)
    ) -> List[Dict]:
        """
        Fetch current flights in airspace
        
        Args:
            bbox: Bounding box for geographic filtering
        """
        url = f"{self.BASE_URL}/states/all"
        params = {}
        
        if bbox and len(bbox) == 4:
            # OpenSky expects lamin, lomin, lamax, lomax
            params["lamin"] = bbox[0]
            params["lomin"] = bbox[1]
            params["lamax"] = bbox[2]
            params["lomax"] = bbox[3]

        headers = {}
        if self.username and self.password:
             import base64
             auth_str = f"{self.username}:{self.password}"
             b64_auth = base64.b64encode(auth_str.encode()).decode()
             headers["Authorization"] = f"Basic {b64_auth}"
        
        try:
            data = await self.fetch_with_retry(url, params=params, headers=headers)
            return self._parse_opensky_response(data)
        except Exception as e:
            print(f"OpenSky fetch error: {e}")
            return []
    
    def _parse_opensky_response(self, data: Dict) -> List[Dict]:
        """Parse OpenSky response - detect anomalies like diversions"""
        flights: List[Dict] = []
        
        states = data.get("states", [])
        if not states:
            return []

        # Limit to 100 flights to avoid overwhelming the system
        for state in states[:100]:
            # OpenSky state vector format:
            # [0] icao24, [1] callsign, [2] origin_country,
            # [3] time_position, [4] last_contact,
            # [5] longitude, [6] latitude, [7] baro_altitude,
            # [8] on_ground, [9] velocity, [10] heading, [11] vertical_rate, ...
            if not state or len(state) < 12:
                continue

            icao24 = state[0]
            callsign = (state[1] or "").strip()
            origin_country = state[2] or "Unknown"
            last_contact = state[4]
            longitude = state[5]
            latitude = state[6]
            altitude = state[7]
            velocity = state[9]
            heading = state[10]

            if latitude is None or longitude is None:
                continue

            flight_title = f"Flight {callsign if callsign else icao24}"
            desc_parts = [f"Origin: {origin_country}"]
            if velocity:
                desc_parts.append(f"Speed: {velocity} m/s")
            description = " | ".join(desc_parts)

            flight_data = {
                "source": "opensky",
                "title": flight_title,
                "description": description,
                "latitude": float(latitude),
                "longitude": float(longitude),
                "location_name": f"Over {origin_country}",
                "event_timestamp": datetime.fromtimestamp(last_contact or time.time()).isoformat(),
                "severity": 0,
                "raw_data": {
                    "icao24": icao24,
                    "callsign": callsign,
                    "velocity": velocity,
                    "altitude": altitude
                },
                "category": "aviation",
            }
            flights.append(flight_data)
        
        return flights


class NASAFIRMSFetcher(BaseDataFetcher):
    """
    Fetch fire data from NASA FIRMS (Fire Information for Resource Management System)
    Real-time wildfire monitoring
    """
    
    BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
    
    def __init__(self):
        super().__init__()
        self.api_key = settings.NASA_FIRMS_API_KEY or settings.NASA_API_KEY or "DEMO_KEY"
    
    async def fetch_fires(
        self,
        bbox: tuple = (-90, -180, 90, 180),  # Default to world
        days: int = 1
    ) -> List[Dict]:
        """
        Fetch active fires in region
        """
        # Format: /KEY/SOURCE/AREA_COORDS/DAY_RANGE
        # Area coords: West,South,East,North
        area_str = f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}"
        
        # VIIRS_NOAA20_NRT is a standard source
        url = f"{self.BASE_URL}/{self.api_key}/VIIRS_NOAA20_NRT/{area_str}/{days}"
        
        try:
            client = await self._get_client()
            response = await client.get(url)
            
            if response.status_code != 200:
                return []
            
            return self._parse_firms_csv(response.text)
        except Exception as e:
            print(f"NASA FIRMS fetch error: {e}")
            return []
    
    def _parse_firms_csv(self, csv_text: str) -> List[Dict]:
        """Parse CSV response from FIRMS"""
        events = []
        lines = csv_text.strip().split("\n")
        
        if len(lines) < 2:
            return events
        
        headers = lines[0].split(",")
        for line in lines[1:]:
            values = line.split(",")
            if len(values) != len(headers):
                continue
            
            row = dict(zip(headers, values))
            try:
                lat = float(row.get("latitude", 0))
                lon = float(row.get("longitude", 0))
                brightness = float(row.get("bright_ti4", 0) or row.get("brightness", 0))
                
                # Normalize brightness (typ. 300-500K) to 0-100 severity
                severity = min(100, max(0, (brightness - 300) / 2))
                
                event = {
                    "source": "nasa_firms",
                    "title": f"Wildfire Detected ({brightness}K)",
                    "latitude": lat,
                    "longitude": lon,
                    "event_timestamp": self._parse_acquisition_date(row),
                    "severity": severity,
                    "raw_data": row,
                    "category": "climate"
                }
                events.append(event)
            except ValueError:
                continue
        
        return events

    def _parse_acquisition_date(self, row: Dict) -> str:
        date = row.get("acq_date", "")
        time_str = row.get("acq_time", "")
        if date:
            if len(time_str) == 4:
                time_fmt = f"{time_str[:2]}:{time_str[2:]}:00"
            else:
                time_fmt = "00:00:00"
            return f"{date}T{time_fmt}Z"
        return datetime.utcnow().isoformat()


class NASAEONETFetcher(BaseDataFetcher):
    """
    Fetch natural events from NASA EONET (Earth Observatory Natural Event Tracker).
    Public API: https://eonet.gsfc.nasa.gov/api/v3/events - no key required.
    """
    BASE_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"

    async def fetch_events(
        self,
        limit: int = 100,
        days_back: int = 7,
    ) -> List[Dict]:
        """Fetch recent natural events (wildfires, storms, volcanoes, etc.)."""
        try:
            # EONET returns events with status=open by default; we can add &limit=
            params = {"limit": limit}
            data = await self.fetch_with_retry(self.BASE_URL, params=params)
            return self._parse_eonet_response(data, days_back)
        except Exception as e:
            print(f"NASA EONET fetch error: {e}")
            return []

    def _parse_eonet_response(self, data: Dict, days_back: int) -> List[Dict]:
        events = []
        cutoff = (datetime.utcnow() - timedelta(days=days_back)).isoformat()
        for ev in data.get("events", []):
            geoms = ev.get("geometry", [])
            if not geoms:
                continue
            # Use latest geometry (first can be forecast)
            g = geoms[-1] if geoms else {}
            coords = g.get("coordinates", [0, 0])
            if len(coords) < 2:
                continue
            lon, lat = float(coords[0]), float(coords[1])
            date_str = g.get("date") or ev.get("lastDate") or ev.get("created") or ""
            if date_str and date_str < cutoff:
                continue
            title = ev.get("title", "Natural Event")
            cat = (ev.get("categories") or [{}])[0] if ev.get("categories") else {}
            cat_title = cat.get("title", "disaster")
            events.append({
                "source": "nasa_eonet",
                "title": title,
                "description": ev.get("description", ""),
                "latitude": lat,
                "longitude": lon,
                "location_name": ev.get("title", ""),
                "event_timestamp": date_str or datetime.utcnow().isoformat(),
                "severity": 50,
                "raw_data": ev,
                "category": "disaster" if "fire" in cat_title.lower() or "storm" in cat_title.lower() else "disaster",
            })
        return events


class FredFetcher(BaseDataFetcher):
    """
    Fetch economic data from FRED (Federal Reserve Economic Data)
    """
    BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
    
    def __init__(self):
        super().__init__()
        self.api_key = settings.FRED_API_KEY
    
    async def fetch_series(self, series_id: str = "GDP") -> List[Dict]:
        if not self.api_key:
            return []
            
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 5
        }
        
        try:
            data = await self.fetch_with_retry(self.BASE_URL, params=params)
            return self._parse_fred_response(data, series_id)
        except Exception as e:
            print(f"FRED fetch error: {e}")
            return []

    def _parse_fred_response(self, data: Dict, series_id: str) -> List[Dict]:
        events = []
        observations = data.get("observations", [])
        
        for obs in observations:
            date = obs.get("date")
            value = obs.get("value")
            if value == ".": continue 
            
            event = {
                "source": "fred",
                "title": f"Economic Indicator: {series_id}",
                "description": f"Value: {value} on {date}",
                "latitude": 38.8977,
                "longitude": -77.0365,
                "location_name": "United States",
                "event_timestamp": f"{date}T00:00:00Z",
                "severity": 0,
                "raw_data": obs,
                "category": "economy"
            }
            events.append(event)
            
        return events


class EIAFetcher(BaseDataFetcher):
    """
    Fetch energy data from EIA (Energy Information Administration)
    """
    BASE_URL = "https://api.eia.gov/v2"
    
    def __init__(self):
        super().__init__()
        self.api_key = settings.EIA_API_KEY

    async def fetch_prices(self):
        if not self.api_key:
             return []
        
        # Example: Petroleum Spot Prices
        url = f"{self.BASE_URL}/petroleum/pri/spt/data/"
        params = {
            "api_key": self.api_key,
            "frequency": "daily",
            "data[0]": "value",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "offset": 0,
            "length": 5
        }
        
        try:
             data = await self.fetch_with_retry(url, params=params)
             return self._parse_eia_response(data)
        except Exception as e:
            print(f"EIA fetch error: {e}")
            return []

    def _parse_eia_response(self, data: Dict) -> List[Dict]:
        response_data = data.get("response", {}).get("data", [])
        events = []
        
        for item in response_data:
            price = item.get("value", 0)
            product = item.get("product-name", "Petroleum")
            date = item.get("period", "")
            
            event = {
                "source": "eia",
                "title": f"Energy Price: {product}",
                "description": f"Price: ${price}",
                "latitude": 38.9072,
                "longitude": -77.0369,
                "location_name": "USA",
                "event_timestamp": f"{date}T00:00:00Z" if len(date) == 10 else datetime.utcnow().isoformat(),
                "severity": 0,
                "raw_data": item,
                "category": "energy"
            }
            events.append(event)
        
        return events


class AviationStackFetcher(BaseDataFetcher):
    """
    Fetch flight data from AviationStack
    """
    BASE_URL = "http://api.aviationstack.com/v1/flights"
    
    def __init__(self):
        super().__init__()
        self.api_key = settings.AVIATIONSTACK_API_KEY
    
    async def fetch_flights(self, limit: int = 20) -> List[Dict]:
        if not self.api_key:
            return []
            
        params = {
            "access_key": self.api_key,
            "limit": limit,
            "flight_status": "active"
        }
        
        try:
            data = await self.fetch_with_retry(self.BASE_URL, params=params)
            return self._parse_response(data)
        except Exception as e:
            print(f"AviationStack fetch error: {e}")
            return []
    
    def _parse_response(self, data: Dict) -> List[Dict]:
        events = []
        for flight in data.get("data", []):
            try:
                live = flight.get("live", {}) or {}
                # Sometimes live data is null if not tracked properly
                if not live: continue

                lat = live.get("latitude")
                lon = live.get("longitude")
                if not lat or not lon: continue
                
                airline = flight.get("airline", {}).get("name", "Unknown Airline")
                flight_num = flight.get("flight", {}).get("iata", "Unknown")
                
                event = {
                    "source": "aviationstack",
                    "title": f"Flight {flight_num} ({airline})",
                    "description": f"Alt: {live.get('altitude', 0)}m",
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "location_name": "In Flight",
                    "event_timestamp": datetime.utcnow().isoformat(),
                    "severity": 0,
                    "raw_data": flight,
                    "category": "aviation"
                }
                events.append(event)
            except Exception:
                continue
        return events

