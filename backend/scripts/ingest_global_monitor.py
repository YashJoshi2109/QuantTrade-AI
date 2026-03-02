#!/usr/bin/env python3
"""
Global Monitor Data Ingestion Script
Run this to populate the database with sample/live data
"""
import asyncio
import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.services.global_monitor_fetchers import (
    GDELTFetcher, ACLEDFetcher, USGSFetcher, OpenSkyFetcher, NASAFIRMSFetcher
)
from app.services.threat_classification import ThreatClassifier, CountryInstabilityCalculator, GeographicClusterDetector
from app.models.global_monitor import (
    GlobalEvent, CountryInstability, GeographicCluster, DataIngestionLog,
    DataSource, EventCategory, ThreatLevel
)
from app.services.ticker_correlation import TickerCorrelationEngine


async def ingest_gdelt(db: Session, classifier: ThreatClassifier):
    """Ingest data from GDELT"""
    print("📰 Fetching GDELT news events...")
    
    fetcher = GDELTFetcher()
    log_start = datetime.utcnow()
    
    try:
        events = await fetcher.fetch_events(timespan="6h", max_records=100)
        
        inserted = 0
        skipped = 0
        
        for event_data in events:
            # Generate event ID
            event_id = f"gdelt_{event_data.get('url', '')[-16:]}".replace("/", "_")
            
            # Check if already exists
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                skipped += 1
                continue
            
            # Classify event
            classification = await classifier.classify_event(event_data)
            if classification.get("skip"):
                skipped += 1
                continue
            
            # Create event
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
        
        # Log ingestion
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
        
        print(f"  ✅ GDELT: {inserted} inserted, {skipped} skipped")
        
    except Exception as e:
        print(f"  ❌ GDELT error: {e}")
        log = DataIngestionLog(
            source=DataSource.GDELT,
            status="failed",
            error_message=str(e)
        )
        db.add(log)
        db.commit()
    
    finally:
        await fetcher.close()


async def ingest_usgs(db: Session, classifier: ThreatClassifier):
    """Ingest earthquake data from USGS"""
    print("🌍 Fetching USGS earthquake data...")
    
    fetcher = USGSFetcher()
    log_start = datetime.utcnow()
    
    try:
        events = await fetcher.fetch_earthquakes(min_magnitude=4.0, timespan_hours=24, limit=50)
        
        inserted = 0
        skipped = 0
        
        for event_data in events:
            event_id = f"usgs_{event_data['raw_data']['id']}"
            
            existing = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
            if existing:
                skipped += 1
                continue
            
            event = GlobalEvent(
                event_id=event_id,
                source=DataSource.USGS,
                category=EventCategory.DISASTER,
                title=event_data["title"][:500],
                description=event_data.get("description", ""),
                latitude=event_data["latitude"],
                longitude=event_data["longitude"],
                location_name=event_data.get("location_name"),
                event_timestamp=datetime.fromisoformat(event_data["event_timestamp"].replace("Z", "+00:00")),
                severity=event_data.get("severity", 50),
                threat_level=ThreatLevel.MEDIUM if event_data.get("severity", 0) > 60 else ThreatLevel.LOW,
                raw_data=event_data.get("raw_data"),
                confidence=0.95  # USGS data is highly reliable
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
        
        print(f"  ✅ USGS: {inserted} inserted, {skipped} skipped")
        
    except Exception as e:
        print(f"  ❌ USGS error: {e}")
        log = DataIngestionLog(
            source=DataSource.USGS,
            status="failed",
            error_message=str(e)
        )
        db.add(log)
        db.commit()
    
    finally:
        await fetcher.close()


def calculate_country_instability(db: Session):
    """Calculate country instability indices"""
    print("📊 Calculating country instability indices...")
    
    calculator = CountryInstabilityCalculator()
    
    # Get all countries with recent events
    cutoff = datetime.utcnow() - timedelta(days=7)
    countries = db.query(GlobalEvent.country_code).filter(
        GlobalEvent.event_timestamp >= cutoff,
        GlobalEvent.country_code.isnot(None)
    ).distinct().all()
    
    updated = 0
    
    for (country_code,) in countries:
        # Get events for this country by category
        events_by_category = {}
        
        for category in EventCategory:
            events = db.query(GlobalEvent).filter(
                GlobalEvent.country_code == country_code,
                GlobalEvent.category == category,
                GlobalEvent.event_timestamp >= cutoff
            ).all()
            
            events_by_category[category.value] = [
                {
                    "severity": e.severity or 50,
                    "threat_level": e.threat_level
                }
                for e in events
            ]
        
        # Calculate index
        result = calculator.calculate_index(events_by_category)
        
        # Update or create record
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
                country_name=country_code,  # Would be looked up from a country database
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
        
        updated += 1
    
    db.commit()
    print(f"  ✅ Updated instability for {updated} countries")


def detect_clusters(db: Session):
    """Detect geographic clusters"""
    print("🗺️  Detecting geographic clusters...")
    
    detector = GeographicClusterDetector()
    
    # Get recent events
    cutoff = datetime.utcnow() - timedelta(hours=24)
    events = db.query(GlobalEvent).filter(
        GlobalEvent.event_timestamp >= cutoff
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
        GeographicCluster.last_event_at < cutoff
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
    print(f"  ✅ Detected {len(clusters)} clusters ({sum(1 for c in clusters if c['is_hotspot'])} hotspots)")


async def main():
    """Main ingestion routine"""
    print("=" * 60)
    print("Global Monitor Data Ingestion")
    print("=" * 60)
    print()
    
    db = SessionLocal()
    classifier = ThreatClassifier()
    
    try:
        # Ingest from various sources
        await ingest_gdelt(db, classifier)
        await ingest_usgs(db, classifier)
        # await ingest_acled(db, classifier)  # Requires API key
        
        print()
        
        # Calculate derived metrics
        calculate_country_instability(db)
        detect_clusters(db)
        
        print()
        print("=" * 60)
        print("✅ Ingestion complete!")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
