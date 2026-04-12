"""
Global Monitor Database Models
Tracks global events, threats, anomalies, and their impact on financial markets
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, JSON, Text, Index, Enum as SQLEnum
from sqlalchemy import JSON as JSONB  # Alias for cross-DB compat (SQLite tests)
from app.db.database import Base
import enum


class ThreatLevel(str, enum.Enum):
    """Threat severity classification"""
    CRITICAL = "critical"      # Immediate market impact (war, major disaster)
    HIGH = "high"             # Significant potential impact
    MEDIUM = "medium"         # Moderate monitoring required
    LOW = "low"               # Informational only
    UNKNOWN = "unknown"       # Pending classification


class EventCategory(str, enum.Enum):
    """Event type classification"""
    CONFLICT = "conflict"                 # Armed conflicts, battles
    POLITICAL = "political"               # Political instability, protests
    DISASTER = "disaster"                 # Natural disasters, earthquakes
    AVIATION = "aviation"                 # Flight tracking, anomalies
    SHIPPING = "shipping"                 # Vessel tracking, port congestion
    CYBER = "cyber"                       # Cyber attacks, network issues
    ECONOMIC = "economic"                 # Economic indicators, FRED data
    PREDICTION = "prediction"             # Polymarket prediction markets
    CLIMATE = "climate"                   # NASA FIRMS fire data
    SPACE = "space"                       # NASA EONET space weather


class DataSource(str, enum.Enum):
    """Data source identifier"""
    GDELT = "gdelt"
    ACLED = "acled"
    OPENSKY = "opensky"
    USGS = "usgs"
    NASA_FIRMS = "nasa_firms"
    NASA_EONET = "nasa_eonet"
    CLOUDFLARE = "cloudflare_radar"
    FRED = "fred"
    POLYMARKET = "polymarket"
    VESSELFINDER = "vesselfinder"
    AISSTREAM = "aisstream"
    EIA = "eia"
    AVIATIONSTACK = "aviationstack"


class GlobalEvent(Base):
    """
    Core global events table - stores all monitored events
    Updated in real-time from multiple data sources
    """
    __tablename__ = "global_events"

    id = Column(Integer, primary_key=True, index=True)
    
    # Event identification
    event_id = Column(String(255), unique=True, nullable=False, index=True)  # Source-specific ID
    source = Column(SQLEnum(DataSource), nullable=False, index=True)
    category = Column(SQLEnum(EventCategory), nullable=False, index=True)
    
    # Core event data
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(Float, nullable=True)  # 0-100 normalized severity score
    threat_level = Column(SQLEnum(ThreatLevel), default=ThreatLevel.UNKNOWN, index=True)
    
    # Geographic data
    latitude = Column(Float, nullable=False, index=True)
    longitude = Column(Float, nullable=False, index=True)
    location_name = Column(String(255), nullable=True)
    country_code = Column(String(3), nullable=True, index=True)  # ISO 3166-1 alpha-3
    region = Column(String(100), nullable=True)
    
    # Temporal data
    event_timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    detected_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), onupdate=datetime.utcnow)
    
    # Classification metadata
    keywords = Column(JSONB, nullable=True)  # Array of detected keywords
    entities = Column(JSONB, nullable=True)  # Extracted entities (people, orgs, locations)
    sentiment_score = Column(Float, nullable=True)  # -1 to 1
    
    # Impact metrics
    estimated_casualties = Column(Integer, nullable=True)
    economic_impact_usd = Column(Float, nullable=True)
    affected_population = Column(Integer, nullable=True)
    
    # Market correlation
    correlated_sectors = Column(JSONB, nullable=True)  # Array of affected sectors
    correlated_tickers = Column(JSONB, nullable=True)  # Array of affected stock symbols
    market_impact_score = Column(Float, nullable=True)  # 0-100 predicted market impact
    
    # Raw data
    raw_data = Column(JSONB, nullable=True)  # Original API response
    source_url = Column(String(500), nullable=True)
    
    # Metadata
    is_active = Column(Boolean, default=True, index=True)
    is_anomaly = Column(Boolean, default=False, index=True)  # Flagged by anomaly detection
    confidence = Column(Float, nullable=True)  # 0-1 confidence score
    
    __table_args__ = (
        Index('idx_events_geo', 'latitude', 'longitude'),
        Index('idx_events_time_threat', 'event_timestamp', 'threat_level'),
        Index('idx_events_active_category', 'is_active', 'category'),
        Index('idx_events_country_threat', 'country_code', 'threat_level'),
    )


class CountryInstability(Base):
    """
    Country-level instability index
    Computed from multiple data sources with weighted formula
    """
    __tablename__ = "country_instability"

    id = Column(Integer, primary_key=True, index=True)
    country_code = Column(String(3), unique=True, nullable=False, index=True)
    country_name = Column(String(100), nullable=False)
    
    # Instability components (0-100 each)
    conflict_score = Column(Float, default=0)      # 40% weight - ACLED data
    political_score = Column(Float, default=0)      # 20% weight - GDELT protests
    disaster_score = Column(Float, default=0)       # 20% weight - USGS + NASA
    economic_score = Column(Float, default=0)       # 20% weight - FRED + prediction markets
    
    # Composite index (0-100)
    instability_index = Column(Float, nullable=False, index=True)  # Weighted average
    risk_level = Column(SQLEnum(ThreatLevel), nullable=False, index=True)
    
    # Temporal tracking
    calculated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), onupdate=datetime.utcnow)
    
    # Historical context
    previous_index = Column(Float, nullable=True)
    index_change = Column(Float, nullable=True)  # Change from previous calculation
    trend = Column(String(20), nullable=True)  # "improving", "worsening", "stable"
    
    # Supporting data
    active_event_count = Column(Integer, default=0)
    critical_event_count = Column(Integer, default=0)
    meta_data = Column(JSONB, nullable=True)
    
    __table_args__ = (
        Index('idx_instability_index', 'instability_index', postgresql_using='btree'),
    )


class EventAnomaly(Base):
    """
    Detected anomalies using Welford streaming algorithm
    Tracks unusual patterns in event frequency, severity, and distribution
    """
    __tablename__ = "event_anomalies"

    id = Column(Integer, primary_key=True, index=True)
    
    # Anomaly identification
    anomaly_type = Column(String(50), nullable=False, index=True)  # "frequency", "severity", "geographic"
    event_category = Column(SQLEnum(EventCategory), nullable=True, index=True)
    
    # Geographic scope
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    radius_km = Column(Float, nullable=True)
    country_code = Column(String(3), nullable=True, index=True)
    
    # Statistical metrics
    observed_value = Column(Float, nullable=False)
    expected_value = Column(Float, nullable=False)
    std_deviation = Column(Float, nullable=False)
    z_score = Column(Float, nullable=False, index=True)  # Standard deviations from mean
    
    # Detection metadata
    detected_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    window_start = Column(DateTime(timezone=True), nullable=False)
    window_end = Column(DateTime(timezone=True), nullable=False)
    sample_size = Column(Integer, nullable=False)
    
    # Anomaly details
    description = Column(Text, nullable=True)
    severity = Column(SQLEnum(ThreatLevel), nullable=False, index=True)
    related_event_ids = Column(JSONB, nullable=True)  # Array of related event IDs
    
    # Market impact
    potential_market_impact = Column(String(500), nullable=True)
    affected_sectors = Column(JSONB, nullable=True)
    
    # Status tracking
    is_active = Column(Boolean, default=True, index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_notes = Column(Text, nullable=True)


class GeographicCluster(Base):
    """
    Geographic convergence detection - multiple events in same area
    Uses 1°×1° cell binning for spatial analysis
    """
    __tablename__ = "geographic_clusters"

    id = Column(Integer, primary_key=True, index=True)
    
    # Grid cell identification
    cell_lat = Column(Float, nullable=False)  # Center of 1° cell
    cell_lon = Column(Float, nullable=False)  # Center of 1° cell
    cell_id = Column(String(50), unique=True, nullable=False, index=True)  # "lat_lon" format
    
    # Cluster metrics
    event_count = Column(Integer, nullable=False, default=0)
    distinct_categories = Column(Integer, nullable=False, default=0)
    avg_severity = Column(Float, nullable=True)
    max_threat_level = Column(SQLEnum(ThreatLevel), nullable=False)
    
    # Temporal data
    first_event_at = Column(DateTime(timezone=True), nullable=False)
    last_event_at = Column(DateTime(timezone=True), nullable=False)
    cluster_age_hours = Column(Float, nullable=True)
    
    # Geographic context
    dominant_country = Column(String(3), nullable=True)
    region_name = Column(String(100), nullable=True)
    
    # Event composition
    event_ids = Column(JSONB, nullable=False)  # Array of event IDs in cluster
    category_breakdown = Column(JSONB, nullable=True)  # Count by category
    
    # Hotspot classification
    is_hotspot = Column(Boolean, default=False, index=True)  # >3 events, multiple categories
    hotspot_score = Column(Float, nullable=True)  # Composite risk score
    
    # Market correlation
    affected_tickers = Column(JSONB, nullable=True)
    affected_sectors = Column(JSONB, nullable=True)
    
    # Metadata
    calculated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_cluster_cell', 'cell_lat', 'cell_lon'),
        Index('idx_cluster_hotspot', 'is_hotspot', 'hotspot_score'),
    )


class TickerImpact(Base):
    """
    Correlation between global events and stock tickers
    Powers the Ticker Impact Drawer feature
    """
    __tablename__ = "ticker_impacts"

    id = Column(Integer, primary_key=True, index=True)
    
    # Event reference
    event_id = Column(String(255), nullable=False, index=True)
    cluster_id = Column(String(50), nullable=True, index=True)  # If part of cluster
    
    # Ticker identification
    ticker = Column(String(10), nullable=False, index=True)
    company_name = Column(String(200), nullable=True)
    sector = Column(String(50), nullable=True)
    
    # Impact metrics
    impact_score = Column(Float, nullable=False)  # 0-100 predicted impact
    correlation_type = Column(String(50), nullable=False)  # "direct", "sector", "supply_chain", "geographic"
    confidence = Column(Float, nullable=False)  # 0-1
    
    # Impact direction
    expected_direction = Column(String(10), nullable=True)  # "positive", "negative", "neutral"
    volatility_increase = Column(Float, nullable=True)  # Expected volatility change (%)
    
    # Reasoning
    impact_reason = Column(Text, nullable=True)  # Human-readable explanation
    correlation_factors = Column(JSONB, nullable=True)  # Key factors driving correlation
    
    # Related assets
    related_etfs = Column(JSONB, nullable=True)  # Relevant ETFs
    peer_tickers = Column(JSONB, nullable=True)  # Similar companies affected
    
    # Temporal data
    calculated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=True)  # Impact relevance expiry
    
    __table_args__ = (
        Index('idx_ticker_event', 'ticker', 'event_id'),
        Index('idx_ticker_impact_score', 'ticker', 'impact_score'),
    )


class DataIngestionLog(Base):
    """
    Track data ingestion from external APIs
    Monitor health, latency, and rate limits
    """
    __tablename__ = "data_ingestion_logs"

    id = Column(Integer, primary_key=True, index=True)
    
    source = Column(SQLEnum(DataSource), nullable=False, index=True)
    ingestion_timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    
    # Ingestion metrics
    records_fetched = Column(Integer, default=0)
    records_inserted = Column(Integer, default=0)
    records_updated = Column(Integer, default=0)
    records_skipped = Column(Integer, default=0)
    
    # Performance
    api_latency_ms = Column(Integer, nullable=True)
    processing_time_ms = Column(Integer, nullable=True)
    total_time_ms = Column(Integer, nullable=True)
    
    # Status
    status = Column(String(20), nullable=False)  # "success", "partial", "failed"
    error_message = Column(Text, nullable=True)
    
    # Rate limiting
    rate_limit_remaining = Column(Integer, nullable=True)
    rate_limit_reset_at = Column(DateTime(timezone=True), nullable=True)
    
    # Circuit breaker state
    circuit_breaker_state = Column(String(20), nullable=True)  # "closed", "open", "half_open"
    
    meta_data = Column(JSONB, nullable=True)


class MarketImpactHistory(Base):
    """
    Historical record of how events actually impacted markets
    Used for ML model training and validation
    """
    __tablename__ = "market_impact_history"

    id = Column(Integer, primary_key=True, index=True)
    
    event_id = Column(String(255), nullable=False, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    
    # Time windows
    event_timestamp = Column(DateTime(timezone=True), nullable=False)
    measurement_timestamp = Column(DateTime(timezone=True), nullable=False)
    hours_after_event = Column(Integer, nullable=False)  # 1, 24, 72, 168 (1 week)
    
    # Actual market movements
    price_change_percent = Column(Float, nullable=False)
    volume_change_percent = Column(Float, nullable=True)
    volatility_change = Column(Float, nullable=True)
    
    # Prediction vs reality
    predicted_impact = Column(Float, nullable=True)
    actual_impact = Column(Float, nullable=False)
    prediction_error = Column(Float, nullable=True)
    
    # Context
    market_sentiment = Column(String(20), nullable=True)  # Overall market condition
    sector_performance = Column(Float, nullable=True)
    
    recorded_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    
    __table_args__ = (
        Index('idx_impact_ticker_time', 'ticker', 'event_timestamp'),
    )
