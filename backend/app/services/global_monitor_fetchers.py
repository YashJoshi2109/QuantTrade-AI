"""
Global Monitor Data Ingestion Services
Fetch data from external APIs with circuit breakers and rate limiting
"""
import asyncio
import httpx
import time
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
        max_retries: int = 3,
        backoff_factor: float = 2.0
    ) -> Dict:
        """Fetch data with exponential backoff retry"""
        client = await self._get_client()
        
        for attempt in range(max_retries):
            try:
                await self.rate_limiter.acquire()
                
                response = await client.get(url, params=params)
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
    
    BASE_URL = "https://api.acleddata.com/acled/read"
    
    def __init__(self):
        super().__init__()
        # ACLED requires authentication (get free key at acleddata.com)
        self.api_key = settings.ACLED_API_KEY if hasattr(settings, 'ACLED_API_KEY') else None
        self.email = settings.ACLED_EMAIL if hasattr(settings, 'ACLED_EMAIL') else None
    
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
        if not self.api_key or not self.email:
            print("ACLED API key not configured")
            return []
        
        # Default to last 7 days
        if not event_date:
            today = datetime.utcnow()
            week_ago = today - timedelta(days=7)
            event_date = f"{week_ago.strftime('%Y-%m-%d')}|{today.strftime('%Y-%m-%d')}"
        
        params = {
            "key": self.api_key,
            "email": self.email,
            "event_date": event_date,
            "event_date_where": event_date_where,
            "limit": limit,
            "format": "json"
        }
        
        try:
            data = await self.fetch_with_retry(self.BASE_URL, params)
            return self._parse_acled_response(data)
        except Exception as e:
            print(f"ACLED fetch error: {e}")
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
        self.rate_limiter = RateLimiter(calls_per_second=0.5)  # 2 calls per 10 seconds for anonymous
    
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
        
        if bbox:
            params["lamin"], params["lomin"], params["lamax"], params["lomax"] = bbox
        
        try:
            data = await self.fetch_with_retry(url, params)
            return self._parse_opensky_response(data)
        except Exception as e:
            print(f"OpenSky fetch error: {e}")
            return []
    
    def _parse_opensky_response(self, data: Dict) -> List[Dict]:
        """Parse OpenSky response - detect anomalies like diversions"""
        flights = []
        
        states = data.get("states", [])
        for state in states:
            # OpenSky state vector format
            flight_data = {
                "icao24": state[0],
                "callsign": state[1],
                "origin_country": state[2],
                "latitude": state[6],
                "longitude": state[5],
                "altitude": state[7],
                "velocity": state[9],
                "heading": state[10],
                "vertical_rate": state[11],
                "last_contact": state[4]
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
        self.api_key = settings.NASA_API_KEY if hasattr(settings, 'NASA_API_KEY') else "DEMO_KEY"
    
    async def fetch_fires(
        self,
        bbox: tuple,  # (lat_min, lon_min, lat_max, lon_max)
        days: int = 1
    ) -> List[Dict]:
        """
        Fetch active fires in region
        
        Args:
            bbox: Bounding box (lat_min, lon_min, lat_max, lon_max)
            days: Days to look back (1-10)
        """
        url = f"{self.BASE_URL}/{self.api_key}/VIIRS_SNPP_NRT/{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}/{days}"
        
        try:
            client = await self._get_client()
            response = await client.get(url)
            response.raise_for_status()
            
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
            
            fire_data = dict(zip(headers, values))
            
            # Brightness as severity indicator
            brightness = float(fire_data.get("bright_ti4", 300))
            severity = min(100, (brightness - 300) / 5)  # Normalize to 0-100
            
            event = {
                "source": "nasa_firms",
                "title": f"Wildfire Detection - Brightness {brightness}K",
                "latitude": float(fire_data.get("latitude", 0)),
                "longitude": float(fire_data.get("longitude", 0)),
                "event_timestamp": fire_data.get("acq_date", ""),
                "severity": severity,
                "raw_data": fire_data,
                "category": "climate"
            }
            events.append(event)
        
        return events


# Additional fetchers for Polymarket, FRED, Cloudflare Radar, VesselFinder
# would be implemented similarly with their respective APIs

