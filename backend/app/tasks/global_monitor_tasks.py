"""
Celery tasks for Global Monitor data ingestion
Schedule these tasks to run periodically for real-time monitoring
"""
from celery import shared_task
from datetime import datetime, timedelta
from typing import List
import asyncio
import time
import hashlib

from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.config import settings
from app.services.global_monitor_fetchers import (
    OpenSkyFetcher, GDELTFetcher, ACLEDFetcher, USGSFetcher,
    NASAFIRMSFetcher, NASAEONETFetcher, FredFetcher, EIAFetcher, AviationStackFetcher,
    BaseDataFetcher
)
from app.services.ais_stream_fetcher import AISStreamFetcher
from app.services.vesselfinder_fetcher import VesselFinderFetcher
from app.services.threat_classification import (
    ThreatClassifier, WelfordAnomalyDetector,
    GeographicClusterDetector, CountryInstabilityCalculator
)
from app.services.ticker_correlation import TickerCorrelationEngine
from app.models.global_monitor import (
    GlobalEvent, TickerImpact,
    EventAnomaly, CountryInstability, GeographicCluster,
    DataIngestionLog, DataSource, EventCategory, ThreatLevel
)


@shared_task(name="sync_opensky_flights")
def sync_opensky_flights():
    """
    Sync flight data from OpenSky Network
    Schedule: Every 5 minutes
    """
    db = SessionLocal()
    try:
        # Run async function in sync context
        asyncio.run(_sync_opensky_flights_async(db))
    finally:
        db.close()


async def _sync_opensky_flights_async(db: Session):
    """Async implementation of OpenSky sync"""
    fetcher = OpenSkyFetcher()
    classifier = ThreatClassifier()
    log_start = datetime.utcnow()
    
    try:
        # Focus on high-risk regions
        bbox_regions = [
            # Middle East
            {"lamin": 12.0, "lomin": 34.0, "lamax": 43.0, "lomax": 63.0},
            # Eastern Europe / Ukraine
            {"lamin": 44.0, "lomin": 22.0, "lamax": 52.0, "lomax": 40.0},
            # Taiwan Strait
            {"lamin": 22.0, "lomin": 118.0, "lamax": 26.0, "lomax": 122.0},
        ]
        
        all_events = []
        for bbox in bbox_regions:
            events = await fetcher.fetch_flights(bbox=bbox)
            all_events.extend(events)
        
        inserted = 0
        skipped = 0
        
        for event_data in all_events:
            event_id = f"opensky_{event_data.get('icao24', '')}_{int(event_data['timestamp'])}"
            # Pass event_id into classifier for proper deduplication
            event_data["event_id"] = event_id
            
            # Check if already exists
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                skipped += 1
                continue
            
            # Classify (military flights get higher threat)
            classification = await classifier.classify_event(event_data)
            if classification.get("skip"):
                skipped += 1
                continue
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.OPENSKY,
                category=classification["category"],
                title=event_data["title"][:500],
                description=event_data.get("description", "")[:1000],
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                location_name=event_data.get("location_name"),
                country_code=event_data.get("country_code"),
                event_timestamp=datetime.fromtimestamp(event_data["timestamp"]),
                threat_level=classification["threat_level"],
                keywords=classification.get("keywords", []),
                raw_data=event_data.get("raw_data"),
                confidence=classification.get("confidence", 0.7)
            )
            
            db.add(event)
            inserted += 1
        
        db.commit()
        
        # Log ingestion
        log = DataIngestionLog(
            source=DataSource.OPENSKY,
            records_fetched=len(all_events),
            records_inserted=inserted,
            records_skipped=skipped,
            total_time_ms=int((datetime.utcnow() - log_start).total_seconds() * 1000),
            status="success"
        )
        db.add(log)
        db.commit()
        
        print(f"OpenSky sync: {inserted} inserted, {skipped} skipped")
        
    except Exception as e:
        print(f"OpenSky sync error: {e}")
        log = DataIngestionLog(
            source=DataSource.OPENSKY,
            status="failed",
            error_message=str(e)
        )
        db.add(log)
        db.commit()
    
    finally:
        await fetcher.close()


@shared_task(name="sync_gdelt_news")
def sync_gdelt_news():
    """
    Sync news events from GDELT
    Schedule: Every 15 minutes
    """
    db = SessionLocal()
    try:
        asyncio.run(_sync_gdelt_news_async(db))
    finally:
        db.close()


async def _sync_gdelt_news_async(db: Session):
    """Async implementation of GDELT sync"""
    fetcher = GDELTFetcher()
    classifier = ThreatClassifier()
    log_start = datetime.utcnow()
    
    try:
        events = await fetcher.fetch_events(
            query="(conflict OR war OR attack OR disaster OR earthquake OR protest OR crisis)",
            timespan="6h",
            max_records=500
        )
        
        inserted = 0
        skipped = 0
        
        for event_data in events:
            event_id = f"gdelt_{event_data.get('url', '')[-16:]}".replace("/", "_")
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                skipped += 1
                continue
            
            classification = await classifier.classify_event(event_data)
            if classification.get("skip"):
                skipped += 1
                continue
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.GDELT,
                category=classification["category"],
                title=event_data["title"][:500],
                description=event_data.get("description", "")[:1000],
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                location_name=event_data.get("location_name"),
                country_code=event_data.get("country_code"),
                event_timestamp=datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00")),
                threat_level=classification["threat_level"],
                keywords=classification.get("keywords", []),
                sentiment_score=event_data.get("sentiment_score"),
                source_url=event_data.get("url"),
                raw_data=event_data.get("raw_data"),
                confidence=classification.get("confidence", 0.8)
            )
            
            db.add(event)
            inserted += 1
        
        db.commit()
        
        log = DataIngestionLog(
            source=DataSource.GDELT,
            records_fetched=len(events),
            records_inserted=inserted,
            records_skipped=skipped,
            total_time_ms=int((datetime.utcnow() - log_start).total_seconds() * 1000),
            status="success"
        )
        db.add(log)
        db.commit()
        
        print(f"GDELT sync: {inserted} inserted, {skipped} skipped")
        
    except Exception as e:
        print(f"GDELT sync error: {e}")
        log = DataIngestionLog(source=DataSource.GDELT, status="failed", error_message=str(e))
        db.add(log)
        db.commit()
    
    finally:
        await fetcher.close()


@shared_task(name="sync_usgs_earthquakes")
def sync_usgs_earthquakes():
    """
    Sync earthquake data from USGS
    Schedule: Every 10 minutes
    """
    db = SessionLocal()
    try:
        asyncio.run(_sync_usgs_earthquakes_async(db))
    finally:
        db.close()


async def _sync_usgs_earthquakes_async(db: Session):
    """Async implementation of USGS sync"""
    fetcher = USGSFetcher()
    log_start = datetime.utcnow()
    
    try:
        # Only fetch significant earthquakes (M4.0+)
        events = await fetcher.fetch_earthquakes(min_magnitude=4.0, timespan_hours=1, limit=100)
        
        inserted = 0
        skipped = 0
        
        for event_data in events:
            event_id = f"usgs_{event_data['raw_data']['id']}"
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                skipped += 1
                continue
            
            # Auto-classify by magnitude
            magnitude = event_data.get("severity", 50)
            if magnitude >= 70:  # M6.0+
                threat_level = ThreatLevel.CRITICAL
            elif magnitude >= 60:  # M5.0+
                threat_level = ThreatLevel.HIGH
            elif magnitude >= 50:  # M4.5+
                threat_level = ThreatLevel.MEDIUM
            else:
                threat_level = ThreatLevel.LOW
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.USGS,
                category=EventCategory.DISASTER,
                title=event_data["title"][:500],
                description=event_data.get("description", "")[:1000],
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                location_name=event_data.get("location_name"),
                event_timestamp=datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00")),
                severity=magnitude,
                threat_level=threat_level,
                raw_data=event_data.get("raw_data"),
                confidence=0.95
            )
            
            db.add(event)
            inserted += 1
        
        db.commit()
        
        log = DataIngestionLog(
            source=DataSource.USGS,
            records_fetched=len(events),
            records_inserted=inserted,
            records_skipped=skipped,
            total_time_ms=int((datetime.utcnow() - log_start).total_seconds() * 1000),
            status="success"
        )
        db.add(log)
        db.commit()
        
        print(f"USGS sync: {inserted} inserted, {skipped} skipped")
        
    except Exception as e:
        print(f"USGS sync error: {e}")
        log = DataIngestionLog(source=DataSource.USGS, status="failed", error_message=str(e))
        db.add(log)
        db.commit()
    
    finally:
        await fetcher.close()


@shared_task(name="sync_acled_conflicts")
def sync_acled_conflicts():
    """
    Sync conflict data from ACLED
    Schedule: Every 30 minutes
    """
    db = SessionLocal()
    try:
        asyncio.run(_sync_acled_conflicts_async(db))
    finally:
        db.close()


async def _sync_acled_conflicts_async(db: Session):
    """Async implementation of ACLED sync"""
    fetcher = ACLEDFetcher()
    classifier = ThreatClassifier()
    log_start = datetime.utcnow()
    
    try:
        events = await fetcher.fetch_conflicts(days=1, limit=200)
        
        inserted = 0
        skipped = 0
        
        for event_data in events:
            event_id = f"acled_{event_data['raw_data']['data_id']}"
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                skipped += 1
                continue
            
            classification = await classifier.classify_event(event_data)
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.ACLED,
                category=classification["category"],
                title=event_data["title"][:500],
                description=event_data.get("description", "")[:1000],
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                location_name=event_data.get("location_name"),
                country_code=event_data.get("country_code"),
                event_timestamp=datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00")),
                threat_level=classification["threat_level"],
                severity=event_data.get("severity"),
                keywords=classification.get("keywords", []),
                raw_data=event_data.get("raw_data"),
                confidence=0.9
            )
            
            db.add(event)
            inserted += 1
        
        db.commit()
        
        log = DataIngestionLog(
            source=DataSource.ACLED,
            records_fetched=len(events),
            records_inserted=inserted,
            records_skipped=skipped,
            total_time_ms=int((datetime.utcnow() - log_start).total_seconds() * 1000),
            status="success"
        )
        db.add(log)
        db.commit()
        
        print(f"ACLED sync: {inserted} inserted, {skipped} skipped")
        
    except Exception as e:
        print(f"ACLED sync error: {e}")
        log = DataIngestionLog(source=DataSource.ACLED, status="failed", error_message=str(e))
        db.add(log)
        db.commit()
    
    finally:
        await fetcher.close()


@shared_task(name="sync_vesselfinder_shipping")
def sync_vesselfinder_shipping():
    """
    Sync vessel positions from VesselFinder for shipping disruptions.
    Schedule: Every 15–30 minutes (configure in Celery beat).
    """
    db = SessionLocal()
    try:
        asyncio.run(_sync_vesselfinder_shipping_async(db))
    finally:
        db.close()


async def _sync_vesselfinder_shipping_async(db: Session):
    """Async implementation of VesselFinder sync."""
    fetcher = VesselFinderFetcher()
    classifier = ThreatClassifier()
    log_start = datetime.utcnow()
    
    try:
        # Read tracked vessels from environment (comma-separated lists)
        imo_str = getattr(settings, "VESSELFINDER_IMO_LIST", "") or ""
        mmsi_str = getattr(settings, "VESSELFINDER_MMSI_LIST", "") or ""
        
        imo_list = [int(x.strip()) for x in imo_str.split(",") if x.strip()] if imo_str else []
        mmsi_list = [int(x.strip()) for x in mmsi_str.split(",") if x.strip()] if mmsi_str else []
        
        events = await fetcher.fetch_vessels(
            imo_list=imo_list or None,
            mmsi_list=mmsi_list or None,
            interval_minutes=60,
            include_satellite=False,
        )
        
        inserted = 0
        skipped = 0
        
        for event_data in events:
            # Deterministic ID based on source event payload
            event_id = BaseDataFetcher.generate_event_id("vesselfinder", event_data)
            event_data["event_id"] = event_id
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                skipped += 1
                continue
            
            classification = await classifier.classify_event(event_data)
            if classification.get("skip"):
                skipped += 1
                continue
            
            ts_raw = event_data.get("event_timestamp")
            try:
                # Handle both ISO strings and "YYYY-MM-DD HH:MM:SS" styles
                if ts_raw and "T" in ts_raw:
                    event_ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                elif ts_raw:
                    event_ts = datetime.strptime(ts_raw, "%Y-%m-%d %H:%M:%S")
                else:
                    event_ts = datetime.utcnow()
            except Exception:
                event_ts = datetime.utcnow()
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.VESSELFINDER,
                category=classification["category"],
                title=event_data["title"][:500],
                description=event_data.get("description", "")[:1000],
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                location_name=event_data.get("location_name"),
                country_code=event_data.get("country_code"),
                event_timestamp=event_ts,
                threat_level=classification["threat_level"],
                severity=event_data.get("severity"),
                keywords=classification.get("keywords", []),
                raw_data=event_data.get("raw_data"),
                confidence=classification.get("confidence", 0.85),
            )
            
            db.add(event)
            inserted += 1
        
        db.commit()
        
        log = DataIngestionLog(
            source=DataSource.VESSELFINDER,
            records_fetched=len(events),
            records_inserted=inserted,
            records_skipped=skipped,
            total_time_ms=int((datetime.utcnow() - log_start).total_seconds() * 1000),
            status="success",
        )
        db.add(log)
        db.commit()
        
        print(f"VesselFinder sync: {inserted} inserted, {skipped} skipped")
    
    except Exception as e:
        print(f"VesselFinder sync error: {e}")
        log = DataIngestionLog(
            source=DataSource.VESSELFINDER,
            status="failed",
            error_message=str(e),
        )
        db.add(log)
        db.commit()
    
    finally:
        await fetcher.close()


@shared_task(name="sync_nasa_fires")
def sync_nasa_fires():
    """
    Sync active fires from NASA FIRMS
    Schedule: Every 4 hours
    """
    db = SessionLocal()
    try:
        asyncio.run(_sync_nasa_fires_async(db))
    finally:
        db.close()

async def _sync_nasa_fires_async(db: Session):
    fetcher = NASAFIRMSFetcher()
    classifier = ThreatClassifier()
    try:
        # Fetch global fires (last 24h)
        events = await fetcher.fetch_fires(days=1)
        inserted = 0
        
        for event_data in events:
            # Create a unique ID based on lat/lon/date/brightness
            lat = event_data['latitude']
            lon = event_data['longitude']
            date = event_data['event_timestamp']
            
            # Use deterministic hash for ID
            id_comp = f"{lat}_{lon}_{date}_{event_data.get('title')}"
            event_id = f"nasa_{hashlib.md5(id_comp.encode()).hexdigest()[:16]}"
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing: continue
            
            classification = await classifier.classify_event(event_data)
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.NASA_FIRMS,
                category=classification.get("category", EventCategory.CLIMATE),
                title=event_data["title"],
                description=event_data.get("description", "Wildfire detected"),
                latitude=lat,
                longitude=lon,
                location_name="Wildfire Zone",
                event_timestamp=datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00")),
                severity=event_data.get("severity", 50),
                threat_level=classification.get("threat_level", ThreatLevel.MEDIUM),
                raw_data=event_data.get("raw_data"),
                confidence=0.8
            )
            db.add(event)
            inserted += 1
            
        db.commit()
        print(f"NASA FIRMS sync: {inserted} inserted")
    except Exception as e:
        print(f"NASA FIRMS sync error: {e}")
    finally:
        await fetcher.close()


@shared_task(name="sync_nasa_eonet")
def sync_nasa_eonet():
    """
    Sync natural events from NASA EONET (no API key required).
    Schedule: Every 6 hours.
    """
    db = SessionLocal()
    try:
        asyncio.run(_sync_nasa_eonet_async(db))
    finally:
        db.close()


async def _sync_nasa_eonet_async(db: Session):
    fetcher = NASAEONETFetcher()
    classifier = ThreatClassifier()
    try:
        events = await fetcher.fetch_events(limit=80, days_back=7)
        inserted = 0
        for event_data in events:
            eid = event_data.get("raw_data", {}).get("id") or event_data.get("title", "")
            event_id = f"eonet_{hashlib.md5(str(eid).encode()).hexdigest()[:16]}"
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                continue
            classification = await classifier.classify_event(event_data)
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.NASA_EONET,
                category=classification.get("category", EventCategory.DISASTER),
                title=event_data["title"][:500],
                description=(event_data.get("description") or "")[:1000],
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                location_name=event_data.get("location_name"),
                event_timestamp=(
                    datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00"))
                    if event_data.get("event_timestamp")
                    else datetime.utcnow()
                ),
                severity=event_data.get("severity", 50),
                threat_level=classification.get("threat_level", ThreatLevel.MEDIUM),
                raw_data=event_data.get("raw_data"),
                confidence=0.85,
            )
            db.add(event)
            inserted += 1
        db.commit()
        print(f"NASA EONET sync: {inserted} inserted")
    except Exception as e:
        print(f"NASA EONET sync error: {e}")
    finally:
        await fetcher.close()


@shared_task(name="sync_fred_economics")
def sync_fred_economics():
    """
    Sync economic indicators from FRED
    Schedule: Daily
    """
    db = SessionLocal()
    try:
        asyncio.run(_sync_fred_economics_async(db))
    finally:
        db.close()

async def _sync_fred_economics_async(db: Session):
    fetcher = FredFetcher()
    classifier = ThreatClassifier()
    # Key indicators
    series_list = ["CPIAUCSL", "UNRATE", "DGS10", "VIXCLS", "GDP"]
    
    try:
        all_events = []
        for series in series_list:
            events = await fetcher.fetch_series(series_id=series)
            # Ensure series_id is preserved in raw_data for ID generation
            for e in events:
                if 'raw_data' not in e:
                    e['raw_data'] = {}
                e['raw_data']['series_id'] = series
            all_events.extend(events)
            
        inserted = 0
        processed_ids = set()
        for event_data in all_events:
            date_str = event_data['event_timestamp'][:10]
            series_id = event_data['raw_data']['series_id'] if 'series_id' in event_data.get('raw_data', {}) else "unknown"
            event_id = f"fred_{series_id}_{date_str}"
            
            if event_id in processed_ids:
                continue
            processed_ids.add(event_id)
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing: continue
            
            classification = await classifier.classify_event(event_data)
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.FRED,
                category=classification.get("category", EventCategory.ECONOMIC),
                title=event_data["title"],
                description=event_data.get("description", ""),
                # Default to Washington DC for US economic data since it's national level
                latitude=38.8951,
                longitude=-77.0364,
                event_timestamp=datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00")),
                threat_level=classification.get("threat_level", ThreatLevel.LOW),
                raw_data=event_data.get("raw_data"),
                confidence=0.9
            )
            db.add(event)
            inserted += 1
            
        db.commit()
        print(f"FRED sync: {inserted} inserted")
    except Exception as e:
        print(f"FRED sync error: {e}")
    finally:
        await fetcher.close()


@shared_task(name="sync_eia_energy")
def sync_eia_energy():
    """Sync EIA Energy Data"""
    db = SessionLocal()
    try:
        asyncio.run(_sync_eia_energy_async(db))
    finally:
        db.close()

async def _sync_eia_energy_async(db: Session):
    fetcher = EIAFetcher()
    classifier = ThreatClassifier()
    try:
        events = await fetcher.fetch_prices()
        inserted = 0
        for event_data in events:
            # Using hash for ID
            data_str = str(event_data['raw_data'])
            event_id = f"eia_{hashlib.md5(data_str.encode()).hexdigest()[:16]}"
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing: continue
            
            classification = await classifier.classify_event(event_data)
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.EIA,
                category=classification.get("category", EventCategory.ECONOMIC),
                title=event_data["title"],
                description=event_data.get("description"),
                # Default to Washington DC for US Energy data
                latitude=38.8951,
                longitude=-77.0364,
                event_timestamp=datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00")),
                threat_level=classification.get("threat_level", ThreatLevel.LOW),
                raw_data=event_data.get("raw_data"),
                confidence=0.9
            )
            db.add(event)
            inserted += 1
        db.commit()
        print(f"EIA sync: {inserted} inserted")
    except Exception as e:
        print(f"EIA sync error: {e}")
    finally:
        await fetcher.close()


@shared_task(name="sync_aviation_stack")
def sync_aviation_stack():
    """Sync AviationStack Flights"""
    db = SessionLocal()
    try:
        asyncio.run(_sync_aviation_stack_async(db))
    finally:
        db.close()

async def _sync_aviation_stack_async(db: Session):
    fetcher = AviationStackFetcher()
    classifier = ThreatClassifier()
    try:
        events = await fetcher.fetch_flights(limit=100)
        inserted = 0
        for event_data in events:
            # Using hash for ID because live flights change constantly
            flight_num = event_data['raw_data'].get('flight', {}).get('iata', 'unknown')
            ts = int(time.time() / 300) # Dedupe per 5 minutes
            event_id = f"avstack_{flight_num}_{ts}"
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing: continue

            classification = await classifier.classify_event(event_data)
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.AVIATIONSTACK,
                category=classification.get("category", EventCategory.AVIATION),
                title=event_data["title"],
                description=event_data.get("description"),
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                event_timestamp=datetime.utcnow(),
                threat_level=classification.get("threat_level", ThreatLevel.LOW),
                raw_data=event_data.get("raw_data"),
                confidence=0.8
            )
            db.add(event)
            inserted += 1
        db.commit()
        print(f"AviationStack sync: {inserted} inserted")
    except Exception as e:
        print(f"AviationStack sync error: {e}")
    finally:
        await fetcher.close()


@shared_task(name="sync_ais_vessels")
def sync_ais_vessels():
    """Sync shipping data from AISStream (WebSocket Snapshot)"""
    db = SessionLocal()
    try:
        asyncio.run(_sync_ais_vessels_async(db))
    finally:
        db.close()

async def _sync_ais_vessels_async(db: Session):
    fetcher = AISStreamFetcher()  # Create fetcher instance
    classifier = ThreatClassifier()
    try:
        # Collect 30 seconds of live data
        vessels = await fetcher.fetch_vessels(duration_seconds=30)
        inserted = 0
        
        for v in vessels:
            try:
                # Use MMSI + timestamp hour as ID to verify unique
                mmsi = v['raw_data']['MetaData']['MMSI']
                ts_key = int(time.time() / 300) # 5 min bucket
                event_id = f"ais_{mmsi}_{ts_key}"
                
                existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
                if existing: continue
                
                # Classify
                classification = await classifier.classify_event(v)
                
                event = GlobalEvent(
                    event_id=event_id,
                    source=DataSource.AISSTREAM,
                    category=classification.get("category", EventCategory.SHIPPING),
                    title=v["title"],
                    description=v.get("description", ""),
                    latitude=v["latitude"],
                    longitude=v["longitude"],
                    location_name=v.get("location_name", "High Seas"),
                    event_timestamp=datetime.utcnow(),
                    threat_level=classification.get("threat_level", ThreatLevel.LOW),
                    raw_data=v.get("raw_data"),
                    confidence=0.9
                )
                db.add(event)
                inserted += 1
            except Exception as inner_e:
                print(f"Skipping vessel: {inner_e}")
                continue
                
        db.commit()
        print(f"AISStream sync: {inserted} vessels tracked")
    except Exception as e:
        print(f"AISStream sync error: {e}")
    finally:
        # No explicit close needed for fetcher unless we add one
        pass


@shared_task(name="calculate_derived_metrics")
def calculate_derived_metrics():
    """
    Calculate country instability and geographic clusters
    Schedule: Every 1 hour
    """
    db = SessionLocal()
    
    try:
        # Calculate country instability
        calculator = CountryInstabilityCalculator()
        cutoff = datetime.utcnow() - timedelta(days=7)
        
        countries = db.query(GlobalEvent.country_code).filter(
            GlobalEvent.event_timestamp >= cutoff,
            GlobalEvent.country_code.isnot(None)
        ).distinct().all()
        
        for (country_code,) in countries:
            events_by_category = {}
            
            for category in EventCategory:
                events = db.query(GlobalEvent).filter(
                    GlobalEvent.country_code == country_code,
                    GlobalEvent.category == category,
                    GlobalEvent.event_timestamp >= cutoff
                ).all()
                
                events_by_category[category.value] = [
                    {"severity": e.severity or 50, "threat_level": e.threat_level}
                    for e in events
                ]
            
            result = calculator.calculate_index(events_by_category)
            
            instability = db.query(CountryInstability).filter(
                CountryInstability.country_code == country_code
            ).first()
            
            if instability:
                instability.previous_index = instability.instability_index
                instability.instability_index = result["instability_index"]
                instability.risk_level = result["risk_level"]
                instability.conflict_score = result["component_scores"]["conflict"]
                instability.political_score = result["component_scores"]["political"]
                instability.disaster_score = result["component_scores"]["disaster"]
                instability.economic_score = result["component_scores"]["economic"]
                instability.active_event_count = result["active_event_count"]
                instability.critical_event_count = result["critical_event_count"]
                instability.updated_at = datetime.utcnow()
            else:
                instability = CountryInstability(
                    country_code=country_code,
                    country_name=country_code,
                    instability_index=result["instability_index"],
                    risk_level=result["risk_level"],
                    conflict_score=result["component_scores"]["conflict"],
                    political_score=result["component_scores"]["political"],
                    disaster_score=result["component_scores"]["disaster"],
                    economic_score=result["component_scores"]["economic"],
                    active_event_count=result["active_event_count"],
                    critical_event_count=result["critical_event_count"]
                )
                db.add(instability)
        
        db.commit()
        
        # Detect geographic clusters
        detector = GeographicClusterDetector()
        cluster_cutoff = datetime.utcnow() - timedelta(hours=24)
        
        events = db.query(GlobalEvent).filter(
            GlobalEvent.event_timestamp >= cluster_cutoff
        ).all()
        
        event_data = [
            {
                "event_id": e.event_id,
                "latitude": e.latitude,
                "longitude": e.longitude,
                "category": e.category,
                "severity": e.severity or 50,
                "threat_level": e.threat_level
            }
            for e in events
        ]
        
        clusters = detector.detect_clusters(event_data)
        
        # Clear old clusters
        db.query(GeographicCluster).filter(
            GeographicCluster.last_event_at < cluster_cutoff
        ).delete()
        
        # Insert new clusters
        for cluster_data in clusters:
            existing = db.query(GeographicCluster).filter(
                GeographicCluster.cell_id == cluster_data["cell_id"]
            ).first()
            
            if existing:
                existing.event_count = cluster_data["event_count"]
                existing.distinct_categories = cluster_data["distinct_categories"]
                existing.avg_severity = cluster_data.get("avg_severity")
                existing.max_threat_level = cluster_data["max_threat_level"]
                existing.is_hotspot = cluster_data["is_hotspot"]
                existing.event_ids = cluster_data["event_ids"]
                existing.category_breakdown = cluster_data.get("category_breakdown")
                existing.updated_at = datetime.utcnow()
            else:
                cluster = GeographicCluster(
                    cell_id=cluster_data["cell_id"],
                    cell_lat=cluster_data["cell_lat"],
                    cell_lon=cluster_data["cell_lon"],
                    event_count=cluster_data["event_count"],
                    distinct_categories=cluster_data["distinct_categories"],
                    avg_severity=cluster_data.get("avg_severity"),
                    max_threat_level=cluster_data["max_threat_level"],
                    is_hotspot=cluster_data["is_hotspot"],
                    event_ids=cluster_data["event_ids"],
                    category_breakdown=cluster_data.get("category_breakdown"),
                    first_event_at=datetime.utcnow(),
                    last_event_at=datetime.utcnow()
                )
                db.add(cluster)
        
        db.commit()
        
        print(f"Calculated instability for {len(countries)} countries")
        print(f"Detected {len(clusters)} clusters")
        
    except Exception as e:
        print(f"Derived metrics error: {e}")
    
    finally:
        db.close()


@shared_task(name="correlate_tickers")
def correlate_tickers():
    """
    Correlate recent events with stock tickers
    Schedule: Every 30 minutes
    """
    db = SessionLocal()
    
    try:
        engine = TickerCorrelationEngine()
        
        # Get events from last hour without ticker correlations
        cutoff = datetime.utcnow() - timedelta(hours=1)
        events = db.query(GlobalEvent).filter(
            GlobalEvent.event_timestamp >= cutoff
        ).outerjoin(TickerImpact).filter(
            TickerImpact.event_id.is_(None)
        ).all()
        
        total_correlations = 0
        
        for event in events:
            event_data = {
                "event_id": event.event_id,
                "category": event.category.value,
                "country_code": event.country_code,
                "threat_level": event.threat_level.value,
                "severity": event.severity or 50,
                "title": event.title,
                "description": event.description or "",
                "keywords": event.keywords or []
            }
            
            correlations = asyncio.run(engine.correlate_event(event_data))
            
            for corr in correlations:
                # Check if already exists
                existing = db.query(TickerImpact).filter(
                    TickerImpact.event_id == event.event_id,
                    TickerImpact.ticker == corr["symbol"]
                ).first()
                
                if existing:
                    continue
                
                impact = TickerImpact(
                    event_id=event.event_id,
                    ticker=corr["symbol"],
                    impact_score=corr["impact_score"],
                    confidence=corr["correlation_confidence"],
                    impact_reason=corr["correlation_reason"],
                    sector=None, # Assuming corr doesn't have sector
                    correlation_type="direct", # Default
                    company_name=None, # Default
                    # impact_sentiment=corr["impact_sentiment"], # Not in model
                    # affected_sectors=corr.get("affected_sectors", []), # JSONB
                    # time_horizon=corr.get("time_horizon", "SHORT_TERM") # Not in model
                )
                
                db.add(impact)
                total_correlations += 1
        
        db.commit()
        
        print(f"Created {total_correlations} ticker correlations for {len(events)} events")
        
    except Exception as e:
        print(f"Ticker correlation error: {e}")
    
    finally:
        db.close()


# Celery Beat Schedule (add this to celeryconfig.py)
CELERY_BEAT_SCHEDULE = {
    "sync-opensky-flights": {
        "task": "sync_opensky_flights",
        "schedule": 300.0,  # Every 5 minutes
    },
    "sync-ais-vessels": {
        "task": "sync_ais_vessels",
        "schedule": 300.0,  # Every 5 minutes
    },
    "sync-gdelt-news": {
        "task": "sync_gdelt_news",
        "schedule": 900.0,  # Every 15 minutes
    },
    "sync-usgs-earthquakes": {
        "task": "sync_usgs_earthquakes",
        "schedule": 600.0,  # Every 10 minutes
    },
    "sync-acled-conflicts": {
        "task": "sync_acled_conflicts",
        "schedule": 1800.0,  # Every 30 minutes
    },
    "sync-nasa-fires": {
        "task": "sync_nasa_fires",
        "schedule": 14400.0,  # Every 4 hours
    },
    "sync-nasa-eonet": {
        "task": "sync_nasa_eonet",
        "schedule": 21600.0,  # Every 6 hours (NASA EONET - no key)
    },
    "sync-fred-economics": {
        "task": "sync_fred_economics",
        "schedule": 86400.0,  # Daily
    },
    "sync-eia-energy": {
        "task": "sync_eia_energy",
        "schedule": 21600.0,  # Every 6 hours
    },
    "sync-aviation-stack": {
        "task": "sync_aviation_stack",
        "schedule": 900.0,  # Every 15 minutes
    },
    "calculate-derived-metrics": {
        "task": "calculate_derived_metrics",
        "schedule": 3600.0,  # Every 1 hour
    },
    "correlate-tickers": {
        "task": "correlate_tickers",
        "schedule": 1800.0,  # Every 30 minutes
    },
}

@shared_task(name="ingest_global_data")
def ingest_global_data():
    """
    Main task to ingest data from all sources
    Aggregates individual sync tasks
    """
    print("🌍 Starting global data ingestion...")
    sync_gdelt_news()
    sync_usgs_earthquakes()
    sync_acled_conflicts()
    sync_opensky_flights()
    sync_nasa_fires()
    sync_nasa_eonet()
    sync_fred_economics()
    sync_eia_energy()
    sync_aviation_stack()
    sync_ais_vessels()
    print("✅ Global data ingestion complete")

@shared_task(name="update_instability_indices")
def update_instability_indices():
    """
    Update country instability indices based on latest data
    """
    print("📊 Updating country instability indices...")
    calculate_derived_metrics()
    print("✅ Instability indices updated")
