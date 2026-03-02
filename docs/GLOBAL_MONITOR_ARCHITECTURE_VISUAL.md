# Global Monitor - Visual Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GLOBAL MONITOR SYSTEM                               │
│                     Real-Time Geopolitical Intelligence                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND (Next.js)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    /monitor - Main Dashboard                         │  │
│  │  ┌───────────────────────────────────────────────────────────────┐  │  │
│  │  │  📊 Statistics Cards                                           │  │  │
│  │  │  Total Events: 157 | Critical: 8 | Hotspots: 5 | Countries: 23│  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  ┌────────────────────┐  ┌───────────────────────────────────────┐ │  │
│  │  │  🌍 3D GLOBE       │  │  🔍 FILTERS                           │ │  │
│  │  │  ----------------  │  │  --------------------------------      │ │  │
│  │  │  • Event markers   │  │  Threat Level: [ALL ▼]                │ │  │
│  │  │  • Color-coded     │  │  Category: [ALL ▼]                    │ │  │
│  │  │  • 🔴 CRITICAL     │  │  Time Range: [24h ▼]                  │ │  │
│  │  │  • 🟠 HIGH         │  │  Country: [ALL ▼]                     │ │  │
│  │  │  • 🟡 MEDIUM       │  │  --------------------------------      │ │  │
│  │  │  • 🟢 LOW          │  │                                        │ │  │
│  │  │  • Click to see    │  │  📋 EVENT LIST                        │ │  │
│  │  │    tickers         │  │  ┌──────────────────────────────────┐│ │  │
│  │  │  • Auto-rotate     │  │  │ 🔴 Military conflict escalates   ││ │  │
│  │  │                    │  │  │    Syria | 2 hours ago           ││ │  │
│  │  │                    │  │  │    → 3 affected tickers          ││ │  │
│  │  │                    │  │  ├──────────────────────────────────┤│ │  │
│  │  │                    │  │  │ 🟠 Earthquake M6.2 detected      ││ │  │
│  │  │                    │  │  │    Japan | 4 hours ago           ││ │  │
│  │  │                    │  │  │    → 7 affected tickers          ││ │  │
│  │  │  [Globe.gl]        │  │  ├──────────────────────────────────┤│ │  │
│  │  │                    │  │  │ 🟡 Cyber attack on banks         ││ │  │
│  │  │                    │  │  │    Estonia | 6 hours ago         ││ │  │
│  │  │                    │  │  │    → 12 affected tickers         ││ │  │
│  │  │                    │  │  └──────────────────────────────────┘│ │  │
│  │  └────────────────────┘  └───────────────────────────────────────┘ │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐│  │
│  │  │  🎯 TICKER IMPACT DRAWER (slides in on event click)            ││  │
│  │  │  ┌─────────────────────────────────────────────────────────────┐│  │
│  │  │  │  EVENT: Military conflict escalates in Syria                ││  │
│  │  │  │  Threat: 🔴 CRITICAL | Category: Conflict                   ││  │
│  │  │  │  ───────────────────────────────────────────────────────────││  │
│  │  │  │  AFFECTED TICKERS (3)                                        ││  │
│  │  │  │  ┌──────────────────────────────────────────────────────┐   ││  │
│  │  │  │  │ XLE - Energy Select Sector SPDR     Impact: 85/100  │   ││  │
│  │  │  │  │ Current: $89.42 (+2.3%)              🔴 BEARISH     │   ││  │
│  │  │  │  │ Reason: Oil supply disruption risk                   │   ││  │
│  │  │  │  │ [+ Add to Watchlist]                                 │   ││  │
│  │  │  │  ├──────────────────────────────────────────────────────┤   ││  │
│  │  │  │  │ CVX - Chevron Corporation            Impact: 78/100  │   ││  │
│  │  │  │  │ Current: $157.23 (+1.8%)             🔴 BEARISH     │   ││  │
│  │  │  │  │ Reason: Regional operations exposure                 │   ││  │
│  │  │  │  │ [+ Add to Watchlist]                                 │   ││  │
│  │  │  │  ├──────────────────────────────────────────────────────┤   ││  │
│  │  │  │  │ LMT - Lockheed Martin                Impact: 72/100  │   ││  │
│  │  │  │  │ Current: $523.45 (+3.1%)             🟢 BULLISH     │   ││  │
│  │  │  │  │ Reason: Defense spending increase                    │   ││  │
│  │  │  │  │ [+ Add to Watchlist]                                 │   ││  │
│  │  │  │  └──────────────────────────────────────────────────────┘   ││  │
│  │  │  └─────────────────────────────────────────────────────────────┘│  │
│  │  └─────────────────────────────────────────────────────────────────┘│  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTP/REST API
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (FastAPI)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        REST API ENDPOINTS                            │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  GET  /api/v1/monitor/events           → List events         │   │   │
│  │  │  GET  /api/v1/monitor/events/{id}      → Event details       │   │   │
│  │  │  GET  /api/v1/monitor/events/{id}/tickers → Affected stocks  │   │   │
│  │  │  GET  /api/v1/monitor/threats           → Threat levels      │   │   │
│  │  │  GET  /api/v1/monitor/anomalies         → Statistical peaks  │   │   │
│  │  │  GET  /api/v1/monitor/country-instability → Country risk     │   │   │
│  │  │  GET  /api/v1/monitor/hotspots          → Geographic clusters│   │   │
│  │  │  GET  /api/v1/monitor/stats             → Dashboard metrics  │   │   │
│  │  │  POST /api/v1/monitor/sync              → Trigger data sync  │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐  │
│  │  THREAT             │  │  TICKER             │  │  DATA           │  │
│  │  CLASSIFICATION     │  │  CORRELATION        │  │  INGESTION      │  │
│  │  ─────────────────  │  │  ─────────────────  │  │  ────────────── │  │
│  │  • Groq Llama 3.1   │  │  • Industry mapping │  │  • 11 sources   │  │
│  │  • Keyword filter   │  │  • Region detection │  │  • Circuit      │  │
│  │  • Redis dedup      │  │  • Sentiment scoring│  │    breakers     │  │
│  │  • Confidence calc  │  │  • Impact scoring   │  │  • Rate limits  │  │
│  │  • Anomaly detect   │  │  • Sector grouping  │  │  • Error logs   │  │
│  │    (Welford algo)   │  │  • Time horizon     │  │                 │  │
│  └──────────────────────┘  └──────────────────────┘  └─────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Celery Background Tasks
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKGROUND WORKERS (Celery)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│  │  Every 5 minutes   │  │  Every 15 minutes  │  │  Every 30 minutes  │   │
│  │  ────────────────  │  │  ────────────────  │  │  ────────────────  │   │
│  │  • OpenSky flights │  │  • GDELT news      │  │  • ACLED conflicts │   │
│  │    (conflict zones)│  │  • NASA EONET      │  │  • VesselFinder    │   │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘   │
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│  │  Every 10 minutes  │  │  Every 1 hour      │  │  Every 30 minutes  │   │
│  │  ────────────────  │  │  ────────────────  │  │  ────────────────  │   │
│  │  • USGS earthquakes│  │  • Calculate       │  │  • Correlate       │   │
│  │  • NASA FIRMS fires│  │    instability     │  │    tickers         │   │
│  │  • Cloudflare cyber│  │  • Detect clusters │  │  • Update impacts  │   │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA STORAGE LAYER                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  POSTGRESQL (7 Tables)                                               │  │
│  │  ┌──────────────────────────────────────────────────────────────┐   │  │
│  │  │  global_events                    - Core event data          │   │  │
│  │  │  threat_classifications           - AI classification results│   │  │
│  │  │  ticker_impacts                   - Stock correlations       │   │  │
│  │  │  anomaly_detections               - Statistical anomalies    │   │  │
│  │  │  country_instabilities            - Country risk indices     │   │  │
│  │  │  geographic_clusters              - Event hotspots           │   │  │
│  │  │  data_ingestion_logs              - Sync history             │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  │  • 15+ indexes for performance                                       │  │
│  │  • Foreign key relationships                                          │  │
│  │  • JSON columns for raw data                                          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  REDIS (Upstash)                                                     │  │
│  │  • LLM response deduplication (24h TTL)                              │  │
│  │  • Circuit breaker state (5min TTL)                                  │  │
│  │  • API rate limiting (1min windows)                                  │  │
│  │  • Query result caching (5min TTL)                                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DATA SOURCES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  🛫 OpenSky Network    🌍 GDELT         ⚔️ ACLED         🌋 USGS            │
│  (Flight tracking)     (Global news)    (Conflicts)     (Earthquakes)       │
│                                                                              │
│  🔥 NASA FIRMS         🌪️ NASA EONET   🔒 Cloudflare    📊 FRED             │
│  (Fire detection)      (Disasters)     (Cyber threats)  (Economics)         │
│                                                                              │
│  📈 Polymarket         🚢 VesselFinder  🤖 Groq LLM                          │
│  (Predictions)         (Maritime)      (AI Classification)                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. External API → Circuit Breaker → Rate Limiter → Raw Event Data          │
│                                                                              │
│  2. Raw Event → Keyword Filter → Groq LLM (if needed) → Threat Level        │
│            ↓                                                                 │
│       Redis Dedup (check if similar event already classified)               │
│                                                                              │
│  3. Classified Event → Ticker Correlation Engine → Impact List               │
│            ↓                                                                 │
│       Symbol Table (existing stocks/ETFs)                                   │
│                                                                              │
│  4. Event Data → Welford Anomaly Detector → Anomaly Flag                    │
│                                                                              │
│  5. Event Data → Geographic Binning (1°×1° cells) → Cluster Detection       │
│                                                                              │
│  6. Event Data → Country Aggregation → Instability Index                    │
│       (40% conflict + 20% political + 20% disaster + 20% economic)          │
│                                                                              │
│  7. All Data → PostgreSQL → REST API → Frontend → User                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          TECHNOLOGY STACK                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Backend:    Python 3.10+, FastAPI, SQLAlchemy, Celery, Redis              │
│  Frontend:   Next.js 14, React 18, TypeScript, Tailwind CSS                │
│  3D Viz:     Three.js, globe.gl 2.45, WebGL                                │
│  Database:   PostgreSQL 15+, pgvector extension                             │
│  Cache:      Upstash Redis (or self-hosted)                                │
│  AI:         Groq Llama 3.1 70B (LLM inference)                             │
│  Testing:    Pytest, React Testing Library                                 │
│  Deploy:     Docker, Docker Compose, Nginx                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          KEY ALGORITHMS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. WELFORD ANOMALY DETECTION                                               │
│     • Streaming algorithm for real-time mean/std calculation                │
│     • O(1) space complexity (no historical storage needed)                  │
│     • Detects events > 2.5σ from moving average                             │
│     • Window size: 100 events per category                                  │
│                                                                              │
│  2. GEOGRAPHIC CLUSTERING                                                   │
│     • 1°×1° cell-based binning (lat/lon grid)                               │
│     • Hotspot threshold: ≥3 events + ≥2 distinct categories                │
│     • O(n) complexity (single pass through events)                          │
│     • Cell ID format: "35.5_139.7" (lat_lon rounded)                        │
│                                                                              │
│  3. COUNTRY INSTABILITY INDEX                                               │
│     • Weighted formula:                                                     │
│       Index = 40% × conflict_score                                          │
│             + 20% × political_score                                         │
│             + 20% × disaster_score                                          │
│             + 20% × economic_score                                          │
│     • Component scores: avg(severity × threat_multiplier)                   │
│     • Threat multipliers: LOW=1, MED=1.5, HIGH=2, CRIT=3                    │
│                                                                              │
│  4. CIRCUIT BREAKER                                                         │
│     • Exponential backoff: 60s → 120s → 300s → 600s                         │
│     • Failure threshold: 5 consecutive errors                               │
│     • Half-open state after timeout (test single request)                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```
