"""
Celery tasks for Global Monitor data ingestion
Schedule these tasks to run periodically for real-time monitoring
"""
from celery import shared_task
from datetime import datetime, timedelta
from typing import List
import asyncio

from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.services.global_monitor_fetchers import (
    OpenSkyFetcher, GDELTFetcher, ACLEDFetcher, USGSFetcher,
    NASAFIRMSFetcher, NASAEONETFetcher, CloudflareRadarFetcher,
    FREDFetcher, PolymarketFetcher, VesselFinderFetcher
)
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
            timespan="15m",
            max_records=500,
            themes=["WAR", "TERROR", "CRISIS", "MARKET_CRASH", "PROTEST"]
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
    # Add other syncs here
    print("✅ Global data ingestion complete")

@shared_task(name="update_instability_indices")
def update_instability_indices():
    """
    Update country instability indices based on latest data
    """
    print("📊 Updating country instability indices...")
    calculate_derived_metrics()
    print("✅ Instability indices updated")
