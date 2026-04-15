"""
Global Monitor API Endpoints
Real-time global event monitoring with market impact analysis
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_, or_, func
from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.global_monitor import (
    GlobalEvent, CountryInstability, EventAnomaly, 
    GeographicCluster, TickerImpact, DataSource,
    EventCategory, ThreatLevel
)
from app.services.ticker_correlation import TickerCorrelationEngine

router = APIRouter(prefix="/api/v1/monitor", tags=["global-monitor"])


# Response models
class EventResponse(BaseModel):
    id: int
    event_id: str
    source: str
    category: str
    title: str
    description: Optional[str]
    severity: Optional[float]
    threat_level: str
    latitude: float
    longitude: float
    location_name: Optional[str]
    country_code: Optional[str]
    event_timestamp: datetime
    keywords: Optional[List[str]]
    market_impact_score: Optional[float]
    correlated_sectors: Optional[List[str]]
    is_anomaly: bool
    
    class Config:
        from_attributes = True


class CountryInstabilityResponse(BaseModel):
    country_code: str
    country_name: str
    instability_index: float
    risk_level: str
    conflict_score: float
    political_score: float
    disaster_score: float
    economic_score: float
    active_event_count: int
    critical_event_count: int
    calculated_at: datetime
    trend: Optional[str]
    
    class Config:
        from_attributes = True


class ClusterResponse(BaseModel):
    id: int
    cell_id: str
    cell_lat: float
    cell_lon: float
    event_count: int
    distinct_categories: int
    avg_severity: Optional[float]
    max_threat_level: str
    is_hotspot: bool
    hotspot_score: Optional[float]
    event_ids: List[str]
    category_breakdown: Optional[dict]
    affected_tickers: Optional[List[str]]
    
    class Config:
        from_attributes = True


class TickerImpactResponse(BaseModel):
    ticker: str
    company_name: Optional[str]
    sector: Optional[str]
    impact_score: float
    correlation_type: str
    confidence: float
    expected_direction: Optional[str]
    impact_reason: Optional[str]
    related_etfs: Optional[List[str]]
    peer_tickers: Optional[List[str]]
    volatility_increase: Optional[float]
    
    class Config:
        from_attributes = True


class AnomalyResponse(BaseModel):
    id: int
    anomaly_type: str
    event_category: Optional[str]
    observed_value: float
    expected_value: float
    z_score: float
    severity: str
    description: Optional[str]
    detected_at: datetime
    country_code: Optional[str]
    
    class Config:
        from_attributes = True


class MapDataResponse(BaseModel):
    """Complete data for map visualization"""
    events: List[EventResponse]
    clusters: List[ClusterResponse]
    instability: List[CountryInstabilityResponse]
    anomalies: List[AnomalyResponse]
    stats: dict


@router.get("/events", response_model=List[EventResponse])
async def get_events(
    category: Optional[str] = None,
    threat_level: Optional[str] = None,
    country_code: Optional[str] = None,
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(100, ge=1, le=1000),
    is_active: bool = True,
    db: Session = Depends(get_db)
):
    """
    Get recent global events
    
    - **category**: Filter by event category (conflict, disaster, etc.)
    - **threat_level**: Filter by threat level (critical, high, medium, low)
    - **country_code**: Filter by ISO country code
    - **hours**: Time window to fetch (default 24h)
    - **limit**: Maximum results
    """
    query = db.query(GlobalEvent).filter(GlobalEvent.is_active == is_active)
    
    # Time filter
    cutoff_time = datetime.utcnow() - timedelta(hours=hours)
    query = query.filter(GlobalEvent.event_timestamp >= cutoff_time)
    
    # Category filter
    if category:
        try:
            cat = EventCategory(category.lower())
            query = query.filter(GlobalEvent.category == cat)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid category: {category}")
    
    # Threat level filter
    if threat_level:
        try:
            level = ThreatLevel(threat_level.lower())
            query = query.filter(GlobalEvent.threat_level == level)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid threat level: {threat_level}")
    
    # Country filter
    if country_code:
        query = query.filter(GlobalEvent.country_code == country_code.upper())
    
    # Order by timestamp and limit
    query = query.order_by(desc(GlobalEvent.event_timestamp)).limit(limit)
    
    events = query.all()
    
    # Convert to response format
    return [
        EventResponse(
            **{k: v for k, v in event.__dict__.items() if not k.startswith('_')}
        )
        for event in events
    ]


@router.get("/hotspots", response_model=List[ClusterResponse])
async def get_hotspots(
    min_events: int = Query(3, ge=2),
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db)
):
    """
    Get geographic hotspots (clusters of multiple events)
    
    - **min_events**: Minimum events to be considered hotspot
    - **hours**: Time window
    """
    cutoff_time = datetime.utcnow() - timedelta(hours=hours)
    
    clusters = db.query(GeographicCluster).filter(
        and_(
            GeographicCluster.is_hotspot == True,
            GeographicCluster.event_count >= min_events,
            GeographicCluster.last_event_at >= cutoff_time
        )
    ).order_by(desc(GeographicCluster.hotspot_score)).limit(50).all()
    
    return [
        ClusterResponse(
            **{k: v for k, v in cluster.__dict__.items() if not k.startswith('_')}
        )
        for cluster in clusters
    ]


@router.get("/instability", response_model=List[CountryInstabilityResponse])
async def get_country_instability(
    min_index: float = Query(0, ge=0, le=100),
    risk_level: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    """
    Get country instability indices
    
    - **min_index**: Minimum instability index threshold (0-100)
    - **risk_level**: Filter by risk level
    - **limit**: Maximum countries to return
    """
    query = db.query(CountryInstability).filter(
        CountryInstability.instability_index >= min_index
    )
    
    if risk_level:
        try:
            level = ThreatLevel(risk_level.lower())
            query = query.filter(CountryInstability.risk_level == level)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid risk level: {risk_level}")
    
    countries = query.order_by(
        desc(CountryInstability.instability_index)
    ).limit(limit).all()
    
    return [
        CountryInstabilityResponse(
            **{k: v for k, v in country.__dict__.items() if not k.startswith('_')}
        )
        for country in countries
    ]


@router.get("/anomalies", response_model=List[AnomalyResponse])
async def get_anomalies(
    anomaly_type: Optional[str] = None,
    min_z_score: float = Query(2.0, ge=0),
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db)
):
    """
    Get detected anomalies
    
    - **anomaly_type**: Type of anomaly (frequency, severity, geographic)
    - **min_z_score**: Minimum z-score threshold
    - **hours**: Time window
    """
    cutoff_time = datetime.utcnow() - timedelta(hours=hours)
    
    query = db.query(EventAnomaly).filter(
        and_(
            EventAnomaly.is_active == True,
            EventAnomaly.detected_at >= cutoff_time,
            EventAnomaly.z_score >= min_z_score
        )
    )
    
    if anomaly_type:
        query = query.filter(EventAnomaly.anomaly_type == anomaly_type)
    
    anomalies = query.order_by(desc(EventAnomaly.z_score)).limit(100).all()
    
    return [
        AnomalyResponse(
            **{k: v for k, v in anomaly.__dict__.items() if not k.startswith('_')}
        )
        for anomaly in anomalies
    ]


@router.get("/ticker-impact/{event_id}", response_model=List[TickerImpactResponse])
async def get_ticker_impact(
    event_id: str,
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """
    Get tickers potentially impacted by a specific event
    Powers the Ticker Impact Drawer
    
    - **event_id**: Event identifier
    - **limit**: Maximum tickers to return
    """
    # Check if we have cached impacts
    cached_impacts = db.query(TickerImpact).filter(
        TickerImpact.event_id == event_id
    ).order_by(desc(TickerImpact.impact_score)).limit(limit).all()
    
    if cached_impacts:
        return [
            TickerImpactResponse(
                **{k: v for k, v in impact.__dict__.items() if not k.startswith('_')}
            )
            for impact in cached_impacts
        ]
    
    # If not cached, compute on the fly
    event = db.query(GlobalEvent).filter(GlobalEvent.event_id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Use correlation engine
    correlation_engine = TickerCorrelationEngine(db)
    
    event_data = {
        "event_id": event.event_id,
        "category": event.category,
        "country_code": event.country_code,
        "severity": event.severity or 50,
        "threat_level": event.threat_level,
        "location_name": event.location_name
    }
    
    impacts = correlation_engine.correlate_event_to_tickers(event_data, max_results=limit)
    
    # Enhance with additional data
    for impact in impacts:
        ticker = impact["ticker"]
        sector = impact.get("sector", "")
        
        impact["related_etfs"] = correlation_engine.get_related_etfs(ticker)
        impact["peer_tickers"] = correlation_engine.get_peer_tickers(ticker, sector)
        impact["volatility_increase"] = correlation_engine.calculate_volatility_increase(
            impact["impact_score"],
            event.threat_level
        )
    
    return [TickerImpactResponse(**impact) for impact in impacts]


@router.get("/map-data", response_model=MapDataResponse)
async def get_map_data(
    hours: int = Query(24, ge=1, le=168),
    include_anomalies: bool = True,
    db: Session = Depends(get_db)
):
    """
    Get complete dataset for map visualization
    Optimized single endpoint to reduce requests
    
    - **hours**: Time window for events
    - **include_anomalies**: Include anomaly data
    """
    cutoff_time = datetime.utcnow() - timedelta(hours=hours)
    
    # Fetch all data in parallel (async would be better but SQLAlchemy sync)
    events = db.query(GlobalEvent).filter(
        and_(
            GlobalEvent.is_active == True,
            GlobalEvent.event_timestamp >= cutoff_time
        )
    ).order_by(desc(GlobalEvent.threat_level), desc(GlobalEvent.severity)).limit(500).all()

    # If ingestion is stale and requested window is empty, gracefully fall back
    # to the most recent active events so the monitor does not hard-flatline.
    if not events:
        events = (
            db.query(GlobalEvent)
            .filter(GlobalEvent.is_active == True)
            .order_by(desc(GlobalEvent.event_timestamp))
            .limit(500)
            .all()
        )
    
    clusters = db.query(GeographicCluster).filter(
        and_(
            GeographicCluster.is_hotspot == True,
            GeographicCluster.last_event_at >= cutoff_time
        )
    ).order_by(desc(GeographicCluster.hotspot_score)).limit(100).all()

    if not clusters:
        clusters = (
            db.query(GeographicCluster)
            .filter(GeographicCluster.is_hotspot == True)
            .order_by(desc(GeographicCluster.last_event_at))
            .limit(100)
            .all()
        )
    
    instability = db.query(CountryInstability).filter(
        CountryInstability.instability_index >= 20
    ).order_by(desc(CountryInstability.instability_index)).limit(100).all()
    
    anomalies = []
    if include_anomalies:
        anomalies = db.query(EventAnomaly).filter(
            and_(
                EventAnomaly.is_active == True,
                EventAnomaly.detected_at >= cutoff_time
            )
        ).order_by(desc(EventAnomaly.z_score)).limit(50).all()

        if not anomalies:
            anomalies = (
                db.query(EventAnomaly)
                .filter(EventAnomaly.is_active == True)
                .order_by(desc(EventAnomaly.detected_at))
                .limit(50)
                .all()
            )
    
    # Calculate statistics
    stats = {
        "total_events": len(events),
        "critical_events": sum(1 for e in events if e.threat_level == ThreatLevel.CRITICAL),
        "high_threat_events": sum(1 for e in events if e.threat_level == ThreatLevel.HIGH),
        "total_hotspots": len(clusters),
        "countries_monitored": len(instability),
        "high_risk_countries": sum(1 for c in instability if c.risk_level in [ThreatLevel.CRITICAL, ThreatLevel.HIGH]),
        "anomalies_detected": len(anomalies),
        "last_updated": datetime.utcnow().isoformat(),
        "time_window_hours": hours
    }
    
    return MapDataResponse(
        events=[EventResponse(**{k: v for k, v in e.__dict__.items() if not k.startswith('_')}) for e in events],
        clusters=[ClusterResponse(**{k: v for k, v in c.__dict__.items() if not k.startswith('_')}) for c in clusters],
        instability=[CountryInstabilityResponse(**{k: v for k, v in i.__dict__.items() if not k.startswith('_')}) for i in instability],
        anomalies=[AnomalyResponse(**{k: v for k, v in a.__dict__.items() if not k.startswith('_')}) for a in anomalies],
        stats=stats
    )


@router.get("/stats")
async def get_monitor_stats(db: Session = Depends(get_db)):
    """Get global monitor statistics"""
    now = datetime.utcnow()
    last_24h = now - timedelta(hours=24)
    last_7d = now - timedelta(days=7)
    
    # Event counts
    total_events = db.query(func.count(GlobalEvent.id)).filter(GlobalEvent.is_active == True).scalar()
    events_24h = db.query(func.count(GlobalEvent.id)).filter(
        and_(GlobalEvent.is_active == True, GlobalEvent.event_timestamp >= last_24h)
    ).scalar()
    events_7d = db.query(func.count(GlobalEvent.id)).filter(
        and_(GlobalEvent.is_active == True, GlobalEvent.event_timestamp >= last_7d)
    ).scalar()
    
    # Threat distribution
    threat_dist = db.query(
        GlobalEvent.threat_level, func.count(GlobalEvent.id)
    ).filter(
        and_(GlobalEvent.is_active == True, GlobalEvent.event_timestamp >= last_24h)
    ).group_by(GlobalEvent.threat_level).all()
    
    # Category distribution
    category_dist = db.query(
        GlobalEvent.category, func.count(GlobalEvent.id)
    ).filter(
        and_(GlobalEvent.is_active == True, GlobalEvent.event_timestamp >= last_24h)
    ).group_by(GlobalEvent.category).all()
    
    return {
        "total_active_events": total_events,
        "events_last_24h": events_24h,
        "events_last_7d": events_7d,
        "threat_distribution": {str(level): count for level, count in threat_dist},
        "category_distribution": {str(cat): count for cat, count in category_dist},
        "total_countries_monitored": db.query(func.count(CountryInstability.id)).scalar(),
        "total_hotspots": db.query(func.count(GeographicCluster.id)).filter(
            GeographicCluster.is_hotspot == True
        ).scalar(),
        "last_updated": now.isoformat()
    }


@router.get("/health")
async def monitor_health(db: Session = Depends(get_db)):
    """Health check for global monitor system"""
    from app.models.global_monitor import DataIngestionLog
    
    # Check recent data ingestion
    recent_logs = db.query(DataIngestionLog).filter(
        DataIngestionLog.ingestion_timestamp >= datetime.utcnow() - timedelta(hours=1)
    ).all()
    
    sources_healthy = {}
    for source in DataSource:
        recent_for_source = [log for log in recent_logs if log.source == source]
        if recent_for_source:
            latest = max(recent_for_source, key=lambda x: x.ingestion_timestamp)
            sources_healthy[source.value] = {
                "status": latest.status,
                "last_fetch": latest.ingestion_timestamp.isoformat(),
                "records_fetched": latest.records_fetched
            }
        else:
            sources_healthy[source.value] = {
                "status": "no_recent_data",
                "last_fetch": None,
                "records_fetched": 0
            }
    
    return {
        "status": "healthy",
        "data_sources": sources_healthy,
        "timestamp": datetime.utcnow().isoformat()
    }
