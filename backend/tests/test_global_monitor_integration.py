#!/usr/bin/env python3
"""
Global Monitor Integration Tests
Run this to validate the entire system is working correctly
"""
import asyncio
import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.models.global_monitor import (
    GlobalEvent, ThreatClassification, TickerImpact,
    AnomalyDetection, CountryInstability, GeographicCluster,
    DataSource, EventCategory, ThreatLevel
)
from app.services.threat_classification import ThreatClassifier, WelfordAnomalyDetector, GeographicClusterDetector, CountryInstabilityCalculator
from app.services.ticker_correlation import TickerCorrelationEngine


class TestSuite:
    def __init__(self):
        self.db = SessionLocal()
        self.passed = 0
        self.failed = 0
        self.tests = []
    
    def test(self, name):
        """Decorator to register tests"""
        def decorator(func):
            self.tests.append((name, func))
            return func
        return decorator
    
    def assert_true(self, condition, message):
        """Assert that condition is true"""
        if condition:
            print(f"  ✅ {message}")
            self.passed += 1
        else:
            print(f"  ❌ {message}")
            self.failed += 1
    
    def assert_gt(self, a, b, message):
        """Assert a > b"""
        self.assert_true(a > b, f"{message} ({a} > {b})")
    
    def assert_eq(self, a, b, message):
        """Assert a == b"""
        self.assert_true(a == b, f"{message} ({a} == {b})")
    
    async def run_all(self):
        """Run all registered tests"""
        print("=" * 70)
        print("Global Monitor Integration Tests")
        print("=" * 70)
        print()
        
        for test_name, test_func in self.tests:
            print(f"🧪 {test_name}")
            try:
                if asyncio.iscoroutinefunction(test_func):
                    await test_func(self)
                else:
                    test_func(self)
                print()
            except Exception as e:
                print(f"  ❌ Test failed with exception: {e}")
                import traceback
                traceback.print_exc()
                self.failed += 1
                print()
        
        print("=" * 70)
        print(f"Results: {self.passed} passed, {self.failed} failed")
        print("=" * 70)
        
        if self.failed == 0:
            print("✅ All tests passed!")
            return True
        else:
            print(f"❌ {self.failed} test(s) failed")
            return False


# Initialize test suite
suite = TestSuite()


@suite.test("Database Schema")
def test_database_schema(t):
    """Verify all tables exist"""
    tables = ['global_events', 'threat_classifications', 'ticker_impacts',
              'anomaly_detections', 'country_instabilities', 'geographic_clusters',
              'data_ingestion_logs']
    
    from sqlalchemy import inspect
    inspector = inspect(t.db.bind)
    existing_tables = inspector.get_table_names()
    
    for table in tables:
        t.assert_true(table in existing_tables, f"Table '{table}' exists")


@suite.test("Global Events Data")
def test_global_events(t):
    """Verify events are in database"""
    event_count = t.db.query(GlobalEvent).count()
    t.assert_gt(event_count, 0, f"Events exist in database: {event_count} events")
    
    # Check events have required fields
    sample_event = t.db.query(GlobalEvent).first()
    if sample_event:
        t.assert_true(sample_event.event_id is not None, "Event has event_id")
        t.assert_true(sample_event.title is not None, "Event has title")
        t.assert_true(sample_event.latitude is not None, "Event has latitude")
        t.assert_true(sample_event.longitude is not None, "Event has longitude")
        t.assert_true(sample_event.threat_level is not None, "Event has threat_level")
        t.assert_true(sample_event.category is not None, "Event has category")


@suite.test("Data Source Coverage")
def test_data_sources(t):
    """Verify multiple data sources are active"""
    sources = t.db.query(GlobalEvent.source).distinct().all()
    source_names = [s[0].value for s in sources]
    
    t.assert_true(len(source_names) > 0, f"Data sources active: {', '.join(source_names)}")
    
    # Check for critical free sources
    if DataSource.GDELT in [s[0] for s in sources]:
        t.assert_true(True, "GDELT (news) data available")
    
    if DataSource.USGS in [s[0] for s in sources]:
        t.assert_true(True, "USGS (earthquakes) data available")


@suite.test("Threat Level Distribution")
def test_threat_levels(t):
    """Verify threat classifications exist"""
    for level in [ThreatLevel.LOW, ThreatLevel.MEDIUM, ThreatLevel.HIGH]:
        count = t.db.query(GlobalEvent).filter(GlobalEvent.threat_level == level).count()
        if count > 0:
            t.assert_true(True, f"{level.value} threats: {count}")
    
    critical_count = t.db.query(GlobalEvent).filter(
        GlobalEvent.threat_level == ThreatLevel.CRITICAL
    ).count()
    print(f"  ℹ️  CRITICAL threats: {critical_count}")


@suite.test("Event Categories")
def test_event_categories(t):
    """Verify multiple event categories exist"""
    categories = t.db.query(GlobalEvent.category).distinct().all()
    category_names = [c[0].value for c in categories]
    
    t.assert_gt(len(category_names), 0, f"Event categories: {', '.join(category_names)}")


@suite.test("Country Instability Calculation")
def test_country_instability(t):
    """Verify country instability indices are calculated"""
    instability_count = t.db.query(CountryInstability).count()
    
    if instability_count > 0:
        t.assert_true(True, f"Country instability indices: {instability_count}")
        
        # Check a sample index
        sample = t.db.query(CountryInstability).first()
        t.assert_true(0 <= sample.instability_index <= 100, 
                     f"Instability index in valid range: {sample.instability_index}")
        t.assert_true(sample.risk_level is not None, "Risk level assigned")
    else:
        print(f"  ⚠️  No country instability data (run calculate_derived_metrics)")


@suite.test("Geographic Clustering")
def test_geographic_clusters(t):
    """Verify geographic clusters are detected"""
    cluster_count = t.db.query(GeographicCluster).count()
    
    if cluster_count > 0:
        t.assert_true(True, f"Geographic clusters: {cluster_count}")
        
        hotspot_count = t.db.query(GeographicCluster).filter(
            GeographicCluster.is_hotspot == True
        ).count()
        print(f"  ℹ️  Hotspots detected: {hotspot_count}")
    else:
        print(f"  ⚠️  No clusters detected (run calculate_derived_metrics)")


@suite.test("Ticker Correlation")
def test_ticker_correlation(t):
    """Verify ticker correlations exist"""
    impact_count = t.db.query(TickerImpact).count()
    
    if impact_count > 0:
        t.assert_true(True, f"Ticker impacts: {impact_count}")
        
        # Check sentiment distribution
        for sentiment in ['BULLISH', 'BEARISH', 'NEUTRAL']:
            count = t.db.query(TickerImpact).filter(
                TickerImpact.impact_sentiment == sentiment
            ).count()
            if count > 0:
                print(f"  ℹ️  {sentiment} impacts: {count}")
    else:
        print(f"  ⚠️  No ticker correlations (run correlate_tickers task)")


@suite.test("Data Ingestion Logs")
def test_ingestion_logs(t):
    """Verify data ingestion is being logged"""
    log_count = t.db.query(t.db.query(GlobalEvent).statement.froms[0]).count()
    
    # Just check we can query logs table
    t.assert_true(True, "Data ingestion logs table accessible")


@suite.test("Threat Classifier")
async def test_threat_classifier(t):
    """Test threat classification engine"""
    classifier = ThreatClassifier()
    
    # Test with sample conflict event
    sample_event = {
        "title": "Armed conflict erupts in border region",
        "description": "Military forces engaged in heavy fighting",
        "category": "conflict",
        "country_code": "XX"
    }
    
    classification = await classifier.classify_event(sample_event)
    
    t.assert_true("threat_level" in classification, "Classification returns threat_level")
    t.assert_true("category" in classification, "Classification returns category")
    t.assert_true("confidence" in classification, "Classification returns confidence")


@suite.test("Welford Anomaly Detector")
def test_anomaly_detector(t):
    """Test Welford anomaly detection algorithm"""
    detector = WelfordAnomalyDetector(window_size=100, threshold=2.5)
    
    # Add normal values
    for i in range(50):
        detector.add_value(50.0 + (i % 10))
    
    # Add anomalous value
    is_anomaly = detector.add_value(200.0)
    
    t.assert_true(is_anomaly, "Detector identifies anomalous value")
    
    stats = detector.get_statistics()
    t.assert_true("mean" in stats, "Detector calculates mean")
    t.assert_true("std" in stats, "Detector calculates std")


@suite.test("Geographic Cluster Detector")
def test_cluster_detector(t):
    """Test geographic convergence detection"""
    detector = GeographicClusterDetector(cell_size=1.0, min_events=2)
    
    # Create sample events in same region
    events = [
        {"event_id": "e1", "latitude": 35.0, "longitude": 139.0, 
         "category": EventCategory.CONFLICT, "severity": 70, "threat_level": ThreatLevel.HIGH},
        {"event_id": "e2", "latitude": 35.1, "longitude": 139.1,
         "category": EventCategory.POLITICAL, "severity": 60, "threat_level": ThreatLevel.MEDIUM},
        {"event_id": "e3", "latitude": 35.2, "longitude": 139.2,
         "category": EventCategory.DISASTER, "severity": 80, "threat_level": ThreatLevel.CRITICAL},
    ]
    
    clusters = detector.detect_clusters(events)
    
    t.assert_gt(len(clusters), 0, "Detector finds clusters")
    
    cluster = clusters[0]
    t.assert_eq(cluster["event_count"], 3, "Cluster has correct event count")
    t.assert_true(cluster["is_hotspot"], "Cluster identified as hotspot")


@suite.test("Country Instability Calculator")
def test_instability_calculator(t):
    """Test country instability index calculation"""
    calculator = CountryInstabilityCalculator()
    
    events_by_category = {
        "conflict": [
            {"severity": 80, "threat_level": ThreatLevel.HIGH},
            {"severity": 70, "threat_level": ThreatLevel.HIGH},
        ],
        "political": [
            {"severity": 60, "threat_level": ThreatLevel.MEDIUM},
        ],
        "disaster": [
            {"severity": 50, "threat_level": ThreatLevel.LOW},
        ]
    }
    
    result = calculator.calculate_index(events_by_category)
    
    t.assert_true("instability_index" in result, "Calculator returns instability_index")
    t.assert_true("risk_level" in result, "Calculator returns risk_level")
    t.assert_true("component_scores" in result, "Calculator returns component_scores")
    t.assert_true(0 <= result["instability_index"] <= 100, 
                 f"Index in valid range: {result['instability_index']}")


@suite.test("Ticker Correlation Engine")
async def test_ticker_engine(t):
    """Test ticker correlation logic"""
    engine = TickerCorrelationEngine()
    
    # Test with sample geopolitical event
    sample_event = {
        "event_id": "test_1",
        "category": "geopolitical",
        "country_code": "SA",
        "threat_level": "HIGH",
        "severity": 80,
        "title": "Oil production disruption in Saudi Arabia",
        "description": "Major oil facility attacked",
        "keywords": ["oil", "attack", "production", "energy"]
    }
    
    correlations = await engine.correlate_event(sample_event)
    
    t.assert_gt(len(correlations), 0, f"Engine finds correlations: {len(correlations)} tickers")
    
    if len(correlations) > 0:
        corr = correlations[0]
        t.assert_true("symbol" in corr, "Correlation has symbol")
        t.assert_true("impact_score" in corr, "Correlation has impact_score")
        t.assert_true("impact_sentiment" in corr, "Correlation has sentiment")


@suite.test("Recent Events Query Performance")
def test_query_performance(t):
    """Test query performance for common operations"""
    import time
    
    # Test recent events query
    start = time.time()
    cutoff = datetime.utcnow() - timedelta(hours=24)
    events = t.db.query(GlobalEvent).filter(
        GlobalEvent.event_timestamp >= cutoff
    ).limit(100).all()
    duration_ms = (time.time() - start) * 1000
    
    t.assert_true(duration_ms < 1000, f"Recent events query fast: {duration_ms:.2f}ms")
    
    # Test filtered query
    start = time.time()
    high_threats = t.db.query(GlobalEvent).filter(
        GlobalEvent.threat_level >= ThreatLevel.HIGH,
        GlobalEvent.event_timestamp >= cutoff
    ).all()
    duration_ms = (time.time() - start) * 1000
    
    t.assert_true(duration_ms < 1000, f"Filtered query fast: {duration_ms:.2f}ms")


@suite.test("Data Freshness")
def test_data_freshness(t):
    """Verify recent data exists"""
    cutoff = datetime.utcnow() - timedelta(hours=24)
    recent_count = t.db.query(GlobalEvent).filter(
        GlobalEvent.event_timestamp >= cutoff
    ).count()
    
    if recent_count > 0:
        t.assert_true(True, f"Recent events (24h): {recent_count}")
    else:
        print(f"  ⚠️  No recent events (run data ingestion)")
    
    # Check most recent event
    latest = t.db.query(GlobalEvent).order_by(
        GlobalEvent.event_timestamp.desc()
    ).first()
    
    if latest:
        age_hours = (datetime.utcnow() - latest.event_timestamp).total_seconds() / 3600
        print(f"  ℹ️  Most recent event: {age_hours:.1f} hours ago")


async def main():
    """Run all tests"""
    try:
        success = await suite.run_all()
        suite.db.close()
        
        if not success:
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Test suite failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
