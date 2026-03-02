"""
VesselFinder AIS data fetcher for Global Monitor
Fetches real-time vessel positions for a configured watchlist of ships.
"""
from datetime import datetime
from typing import List, Dict, Optional, Any

from app.config import settings
from app.services.global_monitor_fetchers import BaseDataFetcher


class VesselFinderFetcher(BaseDataFetcher):
    """
    Fetch vessel position data from VesselFinder AIS API.

    This focuses on a configurable watchlist of key vessels (by IMO/MMSI)
    relevant for shipping and supply-chain risk.
    """

    BASE_URL = "https://api.vesselfinder.com/vessels"

    def __init__(self):
        super().__init__()
        # API key is optional – if not set, this fetcher will be a no-op
        self.api_key = getattr(settings, "VESSELFINDER_API_KEY", None)

    async def fetch_vessels(
        self,
        imo_list: Optional[List[int]] = None,
        mmsi_list: Optional[List[int]] = None,
        interval_minutes: int = 60,
        include_satellite: bool = False,
    ) -> List[Dict]:
        """
        Fetch AIS positions for a watchlist of vessels.

        Args:
            imo_list: List of IMO numbers to track.
            mmsi_list: List of MMSI numbers to track.
            interval_minutes: Max age of positions to return.
            include_satellite: Whether to include satellite AIS positions.
        """
        if not self.api_key:
            print("VesselFinder API key not configured")
            return []

        if not imo_list and not mmsi_list:
            print("VesselFinder: no IMO or MMSI list configured")
            return []

        params: Dict[str, Any] = {
            "userkey": self.api_key,
            "format": "json",
            "interval": str(interval_minutes),
        }

        if include_satellite:
            params["sat"] = "1"

        if imo_list:
            params["imo"] = ",".join(str(i) for i in imo_list)
        if mmsi_list:
            params["mmsi"] = ",".join(str(m) for m in mmsi_list)

        try:
            data = await self.fetch_with_retry(self.BASE_URL, params)
            return self._parse_vessels_response(data)
        except Exception as e:
            print(f"VesselFinder fetch error: {e}")
            return []

    def _parse_vessels_response(self, data: Any) -> List[Dict]:
        """Parse VesselFinder AIS response into standardized event dicts."""
        events: List[Dict] = []

        if not isinstance(data, list):
            return events

        for item in data:
            if not isinstance(item, dict):
                continue

            ais = item.get("AIS") or {}
            lat = ais.get("LATITUDE")
            lon = ais.get("LONGITUDE")
            if lat is None or lon is None:
                continue

            name = ais.get("NAME") or f"MMSI {ais.get('MMSI')}"
            zone = ais.get("ZONE") or ""
            dest = ais.get("DESTINATION") or ""
            title = f"Vessel {name} in {zone or dest or 'open waters'}"

            desc_parts: List[str] = []
            if dest:
                desc_parts.append(f"Destination: {dest}")
            speed = ais.get("SPEED")
            if speed is not None:
                desc_parts.append(f"Speed: {speed} kn")
            draught = ais.get("DRAUGHT")
            if draught is not None:
                desc_parts.append(f"Draught: {draught} m")
            if zone:
                desc_parts.append(f"Zone: {zone}")

            description = " | ".join(desc_parts) if desc_parts else "Maritime shipping activity detected"

            timestamp_str = ais.get("TIMESTAMP")
            try:
                # TIMESTAMP is like "YYYY-MM-DD HH:MM:SS UTC"
                event_ts = (
                    datetime.strptime(timestamp_str.replace(" UTC", ""), "%Y-%m-%d %H:%M:%S")
                    if timestamp_str
                    else datetime.utcnow()
                )
            except Exception:
                event_ts = datetime.utcnow()

            speed_val = 0.0
            try:
                if speed is not None:
                    speed_val = float(speed)
            except (TypeError, ValueError):
                speed_val = 0.0

            event = {
                "source": "vesselfinder",
                "title": title,
                "description": description,
                "latitude": float(lat),
                "longitude": float(lon),
                "location_name": zone or dest,
                "country_code": None,
                "event_timestamp": event_ts.isoformat(),
                # Simple severity proxy from speed (0–100)
                "severity": min(100.0, speed_val * 5.0),
                "raw_data": ais,
                "category": "shipping",
            }
            events.append(event)

        return events

