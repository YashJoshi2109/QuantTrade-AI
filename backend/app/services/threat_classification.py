"""
Threat Classification and Anomaly Detection Engine
Uses Groq LLM for intelligent event classification and Welford algorithm for statistical anomalies
"""
import asyncio
import httpx
import hashlib
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
import math

from app.config import settings
from app.models.global_monitor import ThreatLevel, EventCategory


class WelfordAnomalyDetector:
    """
    Welford's online algorithm for streaming anomaly detection
    Maintains running mean and variance without storing all data points
    """
    
    def __init__(self):
        self.count = 0
        self.mean = 0.0
        self.m2 = 0.0  # Sum of squared differences from mean
        self.min_samples = 10  # Minimum samples before detecting anomalies
    
    def update(self, value: float):
        """Add new data point and update statistics"""
        self.count += 1
        delta = value - self.mean
        self.mean += delta / self.count
        delta2 = value - self.mean
        self.m2 += delta * delta2
    
    def get_variance(self) -> float:
        """Calculate current variance"""
        if self.count < 2:
            return 0.0
        return self.m2 / (self.count - 1)
    
    def get_std_dev(self) -> float:
        """Calculate current standard deviation"""
        return math.sqrt(self.get_variance())
    
    def is_anomaly(self, value: float, threshold_sigma: float = 3.0) -> Tuple[bool, float]:
        """
        Check if value is anomalous
        
        Args:
            value: Value to test
            threshold_sigma: Number of standard deviations for anomaly threshold
        
        Returns:
            (is_anomaly, z_score)
        """
        if self.count < self.min_samples:
            return False, 0.0
        
        std_dev = self.get_std_dev()
        if std_dev == 0:
            return False, 0.0
        
        z_score = (value - self.mean) / std_dev
        is_anomalous = abs(z_score) > threshold_sigma
        
        return is_anomalous, z_score


class RedisDeduplicator:
    """
    Redis-based deduplication for events
    Prevents processing the same event multiple times
    """
    
    def __init__(self, redis_url: Optional[str] = None):
        self.redis_url = redis_url or settings.UPSTASH_REDIS_URL
        self.redis_token = getattr(settings, 'UPSTASH_REDIS_TOKEN', None)
        self.cache: Dict[str, datetime] = {}  # Local cache fallback
        self.ttl_hours = 24  # Keep event IDs for 24 hours
    
    async def is_duplicate(self, event_id: str) -> bool:
        """Check if event has been processed recently"""
        if not self.redis_url:
            # Fallback to local cache
            if event_id in self.cache:
                # Check if still valid
                if datetime.utcnow() - self.cache[event_id] < timedelta(hours=self.ttl_hours):
                    return True
                else:
                    del self.cache[event_id]
            return False
        
        try:
            # Use Upstash Redis REST API
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.redis_url}/get/{event_id}",
                    headers={"Authorization": f"Bearer {self.redis_token}"}
                )
                return response.status_code == 200 and response.json().get("result") is not None
        except Exception as e:
            print(f"Redis check error: {e}")
            return False
    
    async def mark_processed(self, event_id: str):
        """Mark event as processed"""
        if not self.redis_url:
            # Fallback to local cache
            self.cache[event_id] = datetime.utcnow()
            return
        
        try:
            ttl_seconds = self.ttl_hours * 3600
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{self.redis_url}/setex/{event_id}/{ttl_seconds}/1",
                    headers={"Authorization": f"Bearer {self.redis_token}"}
                )
        except Exception as e:
            print(f"Redis mark error: {e}")


class ThreatClassifier:
    """
    AI-powered threat classification using Groq LLM
    Classifies events into threat levels and categories
    """
    
    THREAT_KEYWORDS = {
        ThreatLevel.CRITICAL: [
            "war", "nuclear", "attack", "terrorist", "bombing", "invasion",
            "major earthquake", "tsunami", "catastrophic", "pandemic"
        ],
        ThreatLevel.HIGH: [
            "conflict", "protest", "riot", "military", "earthquake", "hurricane",
            "flood", "wildfire", "explosion", "crash", "cyber attack"
        ],
        ThreatLevel.MEDIUM: [
            "tension", "dispute", "warning", "threat", "alert", "storm",
            "drought", "power outage", "strike", "demonstration"
        ],
        ThreatLevel.LOW: [
            "discussion", "meeting", "announcement", "minor", "small",
            "isolated", "local", "tremor"
        ]
    }
    
    CATEGORY_KEYWORDS = {
        EventCategory.CONFLICT: ["war", "battle", "fight", "military", "combat", "armed"],
        EventCategory.POLITICAL: ["protest", "riot", "election", "government", "political"],
        EventCategory.DISASTER: ["earthquake", "tsunami", "flood", "hurricane", "tornado"],
        EventCategory.AVIATION: ["flight", "aircraft", "airport", "aviation", "plane"],
        EventCategory.SHIPPING: ["ship", "vessel", "port", "cargo", "maritime"],
        EventCategory.CYBER: ["hack", "cyber", "breach", "malware", "ransomware"],
        EventCategory.ECONOMIC: ["inflation", "recession", "gdp", "unemployment", "market"],
        EventCategory.CLIMATE: ["fire", "wildfire", "drought", "temperature", "climate"],
    }
    
    def __init__(self):
        self.groq_api_key = settings.GROQ_API_KEY if hasattr(settings, 'GROQ_API_KEY') else None
        self.groq_base_url = "https://api.groq.com/openai/v1"
        self.deduplicator = RedisDeduplicator()
    
    async def classify_event(self, event_data: Dict) -> Dict:
        """
        Classify event threat level and category
        
        Args:
            event_data: Raw event data with title, description, etc.
        
        Returns:
            Classification results with threat_level, category, reasoning
        """
        # Check for duplicates
        event_id = event_data.get("event_id", "")
        if event_id and await self.deduplicator.is_duplicate(event_id):
            return {"skip": True, "reason": "duplicate"}
        
        # Quick keyword-based classification
        title = event_data.get("title", "").lower()
        description = event_data.get("description", "").lower()
        text = f"{title} {description}"
        
        # Determine category
        category = self._classify_category(text)
        
        # Determine threat level
        threat_level = self._classify_threat_level(text)
        
        # Use LLM for complex cases if API key available
        if self.groq_api_key and threat_level in [ThreatLevel.HIGH, ThreatLevel.CRITICAL]:
            llm_result = await self._llm_classify(event_data)
            if llm_result:
                threat_level = llm_result.get("threat_level", threat_level)
                category = llm_result.get("category", category)
        
        # Mark as processed
        if event_id:
            await self.deduplicator.mark_processed(event_id)
        
        return {
            "threat_level": threat_level,
            "category": category,
            "keywords": self._extract_keywords(text),
            "confidence": 0.85  # Would be actual confidence from LLM
        }
    
    def _classify_category(self, text: str) -> EventCategory:
        """Keyword-based category classification"""
        scores = defaultdict(int)
        
        for category, keywords in self.CATEGORY_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    scores[category] += 1
        
        if not scores:
            return EventCategory.POLITICAL  # Default
        
        return max(scores.items(), key=lambda x: x[1])[0]
    
    def _classify_threat_level(self, text: str) -> ThreatLevel:
        """Keyword-based threat level classification"""
        # Check critical first
        for keyword in self.THREAT_KEYWORDS[ThreatLevel.CRITICAL]:
            if keyword in text:
                return ThreatLevel.CRITICAL
        
        # Then high
        for keyword in self.THREAT_KEYWORDS[ThreatLevel.HIGH]:
            if keyword in text:
                return ThreatLevel.HIGH
        
        # Then medium
        for keyword in self.THREAT_KEYWORDS[ThreatLevel.MEDIUM]:
            if keyword in text:
                return ThreatLevel.MEDIUM
        
        return ThreatLevel.LOW
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract important keywords from text"""
        # Simple extraction - could use NLP libraries for better results
        words = text.lower().split()
        
        # Filter for important words
        important_keywords = []
        for category_keywords in self.CATEGORY_KEYWORDS.values():
            important_keywords.extend(category_keywords)
        for level_keywords in self.THREAT_KEYWORDS.values():
            important_keywords.extend(level_keywords)
        
        found_keywords = [w for w in words if w in set(important_keywords)]
        return list(set(found_keywords))[:10]  # Top 10 unique
    
    async def _llm_classify(self, event_data: Dict) -> Optional[Dict]:
        """Use Groq LLM for advanced classification"""
        if not self.groq_api_key:
            return None
        
        prompt = f"""Classify this global event:

Title: {event_data.get('title', '')}
Description: {event_data.get('description', '')}
Location: {event_data.get('location_name', '')}

Provide:
1. Threat Level (critical/high/medium/low)
2. Category (conflict/political/disaster/aviation/shipping/cyber/economic/climate)
3. Brief reasoning (one sentence)

Respond in JSON format."""
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.groq_base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.groq_api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "mixtral-8x7b-32768",  # Fast Groq model
                        "messages": [
                            {"role": "system", "content": "You are a threat analysis expert."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.3,
                        "max_tokens": 150
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    content = result["choices"][0]["message"]["content"]
                    
                    # Parse JSON response
                    try:
                        parsed = json.loads(content)
                        return {
                            "threat_level": ThreatLevel(parsed.get("threat_level", "low")),
                            "category": EventCategory(parsed.get("category", "political")),
                            "reasoning": parsed.get("reasoning", "")
                        }
                    except:
                        return None
        
        except Exception as e:
            print(f"LLM classification error: {e}")
        
        return None


class CountryInstabilityCalculator:
    """
    Calculate Country Instability Index
    Formula: 40% conflict + 20% political + 20% disaster + 20% economic
    """
    
    WEIGHTS = {
        "conflict": 0.40,
        "political": 0.20,
        "disaster": 0.20,
        "economic": 0.20
    }
    
    def calculate_index(self, country_events: Dict[str, List[Dict]]) -> Dict:
        """
        Calculate instability index for a country
        
        Args:
            country_events: Dict mapping category to list of events
        
        Returns:
            Instability metrics
        """
        scores = {
            "conflict": self._calculate_component_score(country_events.get("conflict", [])),
            "political": self._calculate_component_score(country_events.get("political", [])),
            "disaster": self._calculate_component_score(country_events.get("disaster", [])),
            "economic": self._calculate_component_score(country_events.get("economic", []))
        }
        
        # Weighted average
        instability_index = sum(
            scores[component] * self.WEIGHTS[component]
            for component in scores
        )
        
        # Determine risk level
        if instability_index >= 75:
            risk_level = ThreatLevel.CRITICAL
        elif instability_index >= 50:
            risk_level = ThreatLevel.HIGH
        elif instability_index >= 25:
            risk_level = ThreatLevel.MEDIUM
        else:
            risk_level = ThreatLevel.LOW
        
        return {
            "instability_index": round(instability_index, 2),
            "risk_level": risk_level,
            "component_scores": scores,
            "active_event_count": sum(len(events) for events in country_events.values()),
            "critical_event_count": sum(
                1 for events in country_events.values()
                for event in events
                if event.get("threat_level") == ThreatLevel.CRITICAL
            )
        }
    
    def _calculate_component_score(self, events: List[Dict]) -> float:
        """Calculate score for a single component (0-100)"""
        if not events:
            return 0.0
        
        # Weight by threat level and recency
        total_score = 0.0
        for event in events:
            severity = event.get("severity", 50)
            threat_level = event.get("threat_level", ThreatLevel.LOW)
            
            # Threat level multiplier
            multipliers = {
                ThreatLevel.CRITICAL: 2.0,
                ThreatLevel.HIGH: 1.5,
                ThreatLevel.MEDIUM: 1.0,
                ThreatLevel.LOW: 0.5
            }
            
            multiplier = multipliers.get(threat_level, 1.0)
            total_score += severity * multiplier
        
        # Normalize to 0-100 scale
        avg_score = total_score / len(events)
        return min(100.0, avg_score)


class GeographicClusterDetector:
    """
    Detect geographic convergence using 1°×1° cell binning
    Identifies hotspots where multiple events are occurring
    """
    
    CELL_SIZE_DEGREES = 1.0  # 1 degree lat/lon (~111km at equator)
    HOTSPOT_THRESHOLD = 3  # Minimum events to be considered hotspot
    
    def detect_clusters(self, events: List[Dict]) -> List[Dict]:
        """
        Group events into geographic cells and detect hotspots
        
        Args:
            events: List of events with lat/lon
        
        Returns:
            List of cluster data
        """
        # Group events by cell
        cells = defaultdict(list)
        
        for event in events:
            lat = event.get("latitude", 0)
            lon = event.get("longitude", 0)
            
            cell_lat = math.floor(lat / self.CELL_SIZE_DEGREES) * self.CELL_SIZE_DEGREES + (self.CELL_SIZE_DEGREES / 2)
            cell_lon = math.floor(lon / self.CELL_SIZE_DEGREES) * self.CELL_SIZE_DEGREES + (self.CELL_SIZE_DEGREES / 2)
            
            cell_id = f"{cell_lat:.1f}_{cell_lon:.1f}"
            cells[cell_id].append(event)
        
        # Analyze clusters
        clusters = []
        for cell_id, cell_events in cells.items():
            if len(cell_events) < 2:  # Skip single-event cells
                continue
            
            lat_str, lon_str = cell_id.split("_")
            cell_lat, cell_lon = float(lat_str), float(lon_str)
            
            # Count distinct categories
            categories = set(e.get("category", "unknown") for e in cell_events)
            
            # Calculate metrics
            avg_severity = sum(e.get("severity", 0) for e in cell_events) / len(cell_events)
            max_threat = max(
                (e.get("threat_level", ThreatLevel.LOW) for e in cell_events),
                key=lambda x: list(ThreatLevel).index(x)
            )
            
            is_hotspot = len(cell_events) >= self.HOTSPOT_THRESHOLD and len(categories) >= 2
            
            cluster = {
                "cell_id": cell_id,
                "cell_lat": cell_lat,
                "cell_lon": cell_lon,
                "event_count": len(cell_events),
                "distinct_categories": len(categories),
                "avg_severity": round(avg_severity, 2),
                "max_threat_level": max_threat,
                "is_hotspot": is_hotspot,
                "event_ids": [e.get("event_id") for e in cell_events],
                "category_breakdown": dict(
                    (cat, sum(1 for e in cell_events if e.get("category") == cat))
                    for cat in categories
                )
            }
            
            clusters.append(cluster)
        
        return clusters


class AnomalyDetectionEngine:
    """
    Main anomaly detection engine combining Welford algorithm with domain logic
    """
    
    def __init__(self):
        self.frequency_detectors: Dict[str, WelfordAnomalyDetector] = {}  # Per category
        self.severity_detectors: Dict[str, WelfordAnomalyDetector] = {}  # Per category
    
    def detect_frequency_anomalies(
        self, 
        category: str, 
        event_count: int,
        window_hours: int = 1
    ) -> Optional[Dict]:
        """Detect unusual event frequency"""
        if category not in self.frequency_detectors:
            self.frequency_detectors[category] = WelfordAnomalyDetector()
        
        detector = self.frequency_detectors[category]
        is_anomalous, z_score = detector.is_anomaly(event_count)
        detector.update(event_count)
        
        if is_anomalous:
            return {
                "anomaly_type": "frequency",
                "category": category,
                "observed_value": event_count,
                "expected_value": round(detector.mean, 2),
                "z_score": round(z_score, 2),
                "description": f"Unusual spike in {category} events: {event_count} vs expected {round(detector.mean, 1)}"
            }
        
        return None
    
    def detect_severity_anomalies(
        self,
        category: str,
        avg_severity: float
    ) -> Optional[Dict]:
        """Detect unusual event severity"""
        if category not in self.severity_detectors:
            self.severity_detectors[category] = WelfordAnomalyDetector()
        
        detector = self.severity_detectors[category]
        is_anomalous, z_score = detector.is_anomaly(avg_severity)
        detector.update(avg_severity)
        
        if is_anomalous:
            return {
                "anomaly_type": "severity",
                "category": category,
                "observed_value": avg_severity,
                "expected_value": round(detector.mean, 2),
                "z_score": round(z_score, 2),
                "description": f"Unusual severity for {category} events: {avg_severity:.1f} vs expected {detector.mean:.1f}"
            }
        
        return None
