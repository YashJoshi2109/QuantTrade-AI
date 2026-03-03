import json
import asyncio
import websockets
from datetime import datetime
from typing import List, Dict, Optional
from app.config import settings
from app.services.global_monitor_fetchers import BaseDataFetcher

class AISStreamFetcher(BaseDataFetcher):
    """
    Fetch live vessel positions from AISStream.io via WebSocket
    """
    WS_URL = "wss://stream.aisstream.io/v0/stream"
    
    def __init__(self):
        super().__init__()
        self.api_key = settings.AISSTREAM_API_KEY
    
    async def fetch_vessels(self, duration_seconds: int = 30) -> List[Dict]:
        """
        Connect to AISStream WebSocket for a short duration and collect vessel positions.
        This is designed to be run as a periodic task to get snapshots.
        """
        if not self.api_key:
            print("AISStream API Key missing")
            return []
            
        vessels = {}
        
        subscription_message = {
            "APIKey": self.api_key,
            "BoundingBoxes": [
                # Red Sea / Suez (High Priority)
                [[10, 32], [30, 45]],
                # Strait of Malacca
                [[-5, 95], [10, 110]],
                # Persian Gulf / Hormuz
                [[22, 54], [28, 62]],
                # Cape of Good Hope
                [[-40, 15], [-25, 35]],
                # English Channel
                [[49, -5], [52, 5]],
                # Global (filtered by message type usually, but here we take all in bbox)
                # [[-90, -180], [90, 180]] # Commented out to prevent data flood on free tier
            ],
            # Optional: Filter for Class A vessels (commercial/large)
            "FiltersShipMMSI": [], 
            "FilterMessageTypes": ["PositionReport"] 
        }

        try:
            async with websockets.connect(self.WS_URL) as websocket:
                await websocket.send(json.dumps(subscription_message))
                
                # Collect messages for duration
                end_time = datetime.now().timestamp() + duration_seconds
                
                while datetime.now().timestamp() < end_time:
                    try:
                        message = await asyncio.wait_for(websocket.recv(), timeout=2.0)
                        data = json.loads(message)
                        
                        msg_type = data.get("MessageType")
                        
                        if msg_type == "PositionReport":
                            meta = data.get("MetaData", {})
                            mmsi = meta.get("MMSI")
                            
                            if mmsi:
                                # Store latest position for this MMSI
                                vessels[mmsi] = self._parse_ais_message(data)
                                
                    except asyncio.TimeoutError:
                        continue
                    except Exception as e:
                        print(f"Error receiving AIS message: {e}")
                        break
                        
        except Exception as e:
            print(f"AISStream connection error: {e}")
            return []
            
        return list(vessels.values())

    def _parse_ais_message(self, data: Dict) -> Dict:
        """Parse raw AISStream message"""
        meta = data.get("MetaData", {})
        
        ship_name = meta.get("ShipName", "Unknown Vessel").strip()
        mmsi = meta.get("MMSI")
        lat = meta.get("latitude")
        lon = meta.get("longitude")
        speed = meta.get("SOG", 0) # Speed over ground
        heading = meta.get("COG", 0) # Course over ground
        
        # Determine strict category or threat level?
        # For now, just return event structure
        
        return {
            "source": "aisstream",
            "title": f"Vessel: {ship_name}",
            "description": f"Speed: {speed} kn | Heading: {heading}°",
            "latitude": lat,
            "longitude": lon,
            "location_name": "Maritime Route", # Could infer region from coords
            "event_timestamp": datetime.utcnow().isoformat(),
            "raw_data": data,
            "severity": 0, # Could calculate based on deviation or region
            "category": "shipping"
        }
