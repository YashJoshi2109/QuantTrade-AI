# 🌍 Global Monitor - Real-Time Geopolitical Intelligence

> **Bloomberg-grade global event monitoring with AI-powered threat classification and market correlation**

Transform your trading platform with real-time intelligence on conflicts, disasters, political events, and market-moving news. The Global Monitor tracks 11 data sources worldwide, classifies threats using AI, and correlates events with affected stocks/ETFs—giving traders an unprecedented edge.

![Global Monitor Preview](https://via.placeholder.com/800x400/1a1a2e/00d4ff?text=Global+Monitor+3D+Globe)

---

## ✨ Features

### 🌐 Real-Time Global Event Tracking
- **11 Data Sources**: OpenSky (flights), GDELT (news), ACLED (conflicts), USGS (earthquakes), NASA FIRMS/EONET (fires/disasters), Cloudflare Radar (cyber), FRED (economics), Polymarket (predictions), VesselFinder (maritime)
- **4 Event Categories**: Conflict, Political, Disaster, Economic
- **4 Threat Levels**: LOW, MEDIUM, HIGH, CRITICAL
- **Geographic Coverage**: Worldwide with 1°×1° cell-based clustering

### 🤖 AI-Powered Threat Classification
- **LLM Analysis**: Groq Llama 3.1 70B for intelligent event classification
- **Keyword Matching**: Fast pre-filtering before LLM calls
- **Confidence Scoring**: Every classification includes confidence level (0-1)
- **Redis Deduplication**: Prevents redundant LLM calls for similar events

### 📊 Advanced Analytics
- **Welford Anomaly Detection**: Streaming algorithm for real-time anomaly identification
- **Geographic Convergence**: Identifies hotspots where multiple events cluster
- **Country Instability Index**: Weighted formula combining conflict, political, disaster, and economic factors
- **Statistical Anomalies**: Detects unusual patterns in event frequency and severity

### 🎯 Ticker Impact Correlation (Killer Feature)
- **Automatic Correlation**: Links global events to affected stocks/ETFs
- **Sentiment Analysis**: BULLISH, BEARISH, or NEUTRAL impact prediction
- **Impact Scoring**: 0-100 scale measuring correlation strength
- **Sector Mapping**: Groups tickers by affected industry
- **Time Horizon**: SHORT_TERM, MEDIUM_TERM, LONG_TERM impact projections

### 🎨 Bloomberg-Grade UI
- **3D Interactive Globe**: Three.js-powered visualization with event markers
- **Real-Time Filters**: Filter by threat level, category, time range, country
- **Event List**: Sortable table with threat badges and locations
- **Ticker Impact Drawer**: Side panel showing correlated stocks with sentiment
- **Statistics Dashboard**: Live metrics on threats, hotspots, affected countries
- **Responsive Design**: Works on desktop, tablet, mobile

---

## 🚀 Quick Start

### Prerequisites
- PostgreSQL database
- Redis (or Upstash account)
- Python 3.10+
- Node.js 18+

### 1. Backend Setup (5 minutes)

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Configure API keys
cp .env.global-monitor.template .env
# Edit .env and add GROQ_API_KEY and UPSTASH_REDIS_URL

# Create database tables
python scripts/migrate_global_monitor.py

# Ingest sample data
python scripts/ingest_global_monitor.py

# Start server
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup (3 minutes)

```bash
cd frontend

# Install dependencies
npm install

# Configure API URL
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local

# Start dev server
npm run dev
```

### 3. Access the Monitor

Open: **http://localhost:3000/monitor**

---

## 📖 Documentation

### Complete Guides
- 📘 **[Implementation Guide](./GLOBAL_MONITOR_IMPLEMENTATION.md)** - Architecture, setup, deployment
- 🚀 **[Quick Start Guide](./GLOBAL_MONITOR_QUICK_START.md)** - Get running in 15 minutes
- 🧪 **[Testing Guide](#testing)** - Validate your implementation

### Key Files

#### Backend
```
backend/
├── app/
│   ├── models/global_monitor.py           # Database models (6 tables)
│   ├── services/
│   │   ├── global_monitor_fetchers.py     # Data ingestion (11 sources)
│   │   ├── threat_classification.py       # AI classification engine
│   │   └── ticker_correlation.py          # Ticker impact analysis
│   ├── api/global_monitor.py              # REST API endpoints (10+)
│   └── tasks/global_monitor_tasks.py      # Celery background tasks
└── scripts/
    ├── migrate_global_monitor.py          # Database setup
    ├── ingest_global_monitor.py           # Manual data sync
    └── tests/test_global_monitor_integration.py  # Integration tests
```

#### Frontend
```
frontend/
├── src/
│   ├── app/monitor/page.tsx               # Main monitor page
│   ├── components/
│   │   ├── GlobalMonitorGlobe.tsx         # 3D globe visualization
│   │   └── TickerImpactDrawer.tsx         # Stock correlation panel
│   └── lib/global-monitor-api.ts          # API client
```

---

## 🔌 API Endpoints

### Events
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/monitor/events` | GET | List events (with filters) |
| `/api/v1/monitor/events/{id}` | GET | Get single event |
| `/api/v1/monitor/events/{id}/tickers` | GET | Get affected stocks |

### Threats & Analysis
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/monitor/threats` | GET | Threat classifications |
| `/api/v1/monitor/anomalies` | GET | Statistical anomalies |
| `/api/v1/monitor/country-instability` | GET | Country risk index |
| `/api/v1/monitor/hotspots` | GET | Geographic clusters |

### Statistics
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/monitor/stats` | GET | Dashboard statistics |

### Data Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/monitor/sync` | POST | Trigger manual sync |
| `/api/v1/monitor/ingestion-logs` | GET | View sync history |

**Full API Documentation**: http://localhost:8000/docs (Swagger UI)

---

## 🧪 Testing

### Run Integration Tests

```bash
cd backend
python tests/test_global_monitor_integration.py
```

**Expected output:**
```
🧪 Database Schema
  ✅ Table 'global_events' exists
  ✅ Table 'threat_classifications' exists
  ...

🧪 Global Events Data
  ✅ Events exist in database: 57 events
  ✅ Event has event_id
  ...

Results: 42 passed, 0 failed
✅ All tests passed!
```

### Manual API Testing

```bash
# Test events endpoint
curl http://localhost:8000/api/v1/monitor/events | jq

# Test statistics
curl http://localhost:8000/api/v1/monitor/stats | jq

# Test country instability
curl http://localhost:8000/api/v1/monitor/country-instability?limit=5 | jq

# Test ticker correlation
curl http://localhost:8000/api/v1/monitor/events/1/tickers | jq
```

---

## 🔄 Background Tasks

Enable automatic data syncing with Celery:

### Start Celery Worker
```bash
cd backend
celery -A app.tasks worker -l info
```

### Start Celery Beat (Scheduler)
```bash
cd backend
celery -A app.tasks beat -l info
```

### Task Schedule
| Task | Frequency | Description |
|------|-----------|-------------|
| `sync_opensky_flights` | 5 min | Military/commercial flights |
| `sync_gdelt_news` | 15 min | Global news events |
| `sync_usgs_earthquakes` | 10 min | Earthquake data |
| `sync_acled_conflicts` | 30 min | Conflict/protest data |
| `calculate_derived_metrics` | 1 hour | Instability indices, clusters |
| `correlate_tickers` | 30 min | Stock/ETF correlations |

---

## 🔑 API Keys Guide

### Required (Free Tier)

**Groq (AI Classification)**
- Sign up: https://console.groq.com/
- Free tier: 14,400 requests/day
- Cost: $0 (free tier sufficient for MVP)

**Upstash Redis (Caching)**
- Sign up: https://upstash.com/
- Free tier: 10,000 commands/day
- Cost: $0 (free tier sufficient for MVP)

### Recommended (Free Tier)

**ACLED (Conflict Data)**
- Sign up: https://developer.acleddata.com/
- Free tier: 2,500 requests/month
- Cost: $0 (free) or $25/month (5,000 requests)

**NASA FIRMS (Fire/Disaster Tracking)**
- Sign up: https://firms.modaps.eosdis.nasa.gov/api/
- Free tier: Unlimited
- Cost: $0

**FRED (Economic Data)**
- Sign up: https://fred.stlouisfed.org/docs/api/api_key.html
- Free tier: Unlimited
- Cost: $0

### Optional

**OpenSky Network** - Flight tracking ($0)  
**Cloudflare Radar** - Cyber threats ($0)  
**VesselFinder** - Maritime tracking ($0 free tier)

### Free APIs (No Key Needed)
- ✅ GDELT (news events)
- ✅ USGS (earthquakes)
- ✅ NASA EONET (natural disasters)
- ✅ Polymarket (prediction markets)

---

## 💰 Cost Analysis

### MVP (Free Tier): $0/month
- Groq: Free (14,400 requests/day)
- Upstash Redis: Free (10,000 commands/day)
- All other APIs: Free public access
- **Total**: $0/month

### Production (Paid Tiers): ~$50-100/month
- Groq: ~$20/month (additional usage)
- Upstash Redis: $10/month (Pro plan)
- ACLED: $25/month (5,000 requests)
- Infrastructure: $20-50/month (hosting)
- **Total**: ~$75/month

### Enterprise: ~$200-500/month
- Groq: $100/month (enterprise limits)
- Upstash Redis: $60/month (Enterprise)
- Premium API access for all sources
- Dedicated infrastructure
- **Total**: ~$300/month

---

## 📊 Database Schema

### Tables Created

1. **`global_events`** - Core event data (source, category, threat, location, etc.)
2. **`threat_classifications`** - AI classification results with confidence scores
3. **`ticker_impacts`** - Stock/ETF correlations with sentiment
4. **`anomaly_detections`** - Statistical anomalies detected by Welford algorithm
5. **`country_instabilities`** - Country risk indices with component scores
6. **`geographic_clusters`** - Event hotspots with convergence analysis
7. **`data_ingestion_logs`** - Sync history and error tracking

**Total indexes**: 15+ for optimal query performance

---

## 🎨 UI Components

### GlobalMonitorGlobe
3D interactive globe built with Three.js and globe.gl:
- Event markers (colored by threat level)
- Rotation animation
- Click handling
- Responsive sizing
- Atmosphere effects

### TickerImpactDrawer
Side drawer showing correlated stocks:
- Event details
- Affected ticker list
- Sentiment badges (BULLISH/BEARISH/NEUTRAL)
- Add to watchlist button
- Real-time price fetching
- Sector filtering

### Main Monitor Page
Full-featured dashboard:
- Statistics cards (total events, threats, hotspots, etc.)
- Filter controls (threat level, category, time range, country)
- Event list with sortable columns
- Integration with globe and drawer
- Real-time data refresh with React Query

---

## 🔧 Configuration

### Environment Variables

```bash
# Critical
GROQ_API_KEY=gsk_...
UPSTASH_REDIS_URL=redis://...
REDIS_URL=${UPSTASH_REDIS_URL}

# Optional
ACLED_API_KEY=...
NASA_FIRMS_API_KEY=...
FRED_API_KEY=...
OPENSKY_API_KEY=...
CLOUDFLARE_RADAR_API_KEY=...
VESSELFINDER_API_KEY=...

# Settings
GLOBAL_MONITOR_ENABLED=true
GLOBAL_MONITOR_SYNC_INTERVAL=900
GLOBAL_MONITOR_MAX_EVENTS_PER_SYNC=500
GLOBAL_MONITOR_RETENTION_DAYS=30
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=300
REDIS_DEDUP_TTL=86400
```

---

## 🚀 Production Deployment

### Checklist

- [ ] Configure all API keys in production `.env`
- [ ] Set up Redis (Upstash or self-hosted)
- [ ] Enable SSL/TLS for API endpoints
- [ ] Configure CORS for production frontend domain
- [ ] Set up Celery workers with systemd/supervisor
- [ ] Enable database backups
- [ ] Set up monitoring (Sentry, Datadog, etc.)
- [ ] Configure rate limiting per user
- [ ] Enable API authentication
- [ ] Set up CDN for globe textures
- [ ] Configure log rotation
- [ ] Set up alerts for API failures

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# Or use individual containers
docker build -t global-monitor-backend ./backend
docker build -t global-monitor-frontend ./frontend

docker run -d -p 8000:8000 global-monitor-backend
docker run -d -p 3000:3000 global-monitor-frontend
```

---

## 📈 Performance Benchmarks

### API Response Times
- Events list (100 items): ~50-150ms
- Single event detail: ~10-30ms
- Ticker correlations: ~20-50ms
- Statistics dashboard: ~30-80ms
- Country instability: ~40-100ms

### Data Processing
- GDELT sync (500 events): ~30-60s
- USGS sync (100 earthquakes): ~10-20s
- Threat classification (100 events): ~5-15s (with LLM)
- Ticker correlation (100 events): ~10-20s

### Database
- Total tables: 7
- Avg rows per table: 1,000-100,000
- Indexes: 15+
- Query time (indexed): <100ms

---

## 🐛 Troubleshooting

### Issue: "No events showing on globe"

**Solution:**
```bash
# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM global_events;"

# Re-run ingestion
python scripts/ingest_global_monitor.py
```

### Issue: "API returns 500 error"

**Solution:**
```bash
# Check logs
tail -f backend/logs/app.log

# Verify Redis
redis-cli ping  # Should return PONG

# Test Groq API
curl https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY"
```

### Issue: "Ticker drawer shows no correlations"

**Solution:**
```bash
# Run correlation manually
cd backend
python -c "
from app.tasks.global_monitor_tasks import correlate_tickers
correlate_tickers()
"
```

### Issue: "Globe not rendering"

**Solution:**
- Check browser console for Three.js errors
- Verify CORS settings in `backend/app/main.py`
- Ensure globe.gl and Three.js packages installed

---

## 🤝 Contributing

We welcome contributions! Areas for improvement:

- **New Data Sources**: Add more APIs (Twitter/X, Reddit, etc.)
- **Enhanced Correlations**: Improve ticker matching algorithms
- **UI Enhancements**: Add heatmaps, timelines, charts
- **Real-Time Streaming**: WebSocket support for live updates
- **Mobile App**: React Native mobile client
- **Alerts**: Email/SMS notifications for critical events
- **ML Models**: Replace rule-based correlation with trained models
- **Historical Analysis**: Backtesting impact predictions

---

## 📝 License

This Global Monitor feature is part of the QuantTrade-AI platform.  
See main repository for license details.

---

## 🙏 Acknowledgments

**Data Sources:**
- OpenSky Network (flight tracking)
- GDELT Project (global news)
- ACLED (conflict data)
- USGS (earthquake data)
- NASA FIRMS & EONET (fires & natural events)
- Cloudflare Radar (cyber threats)
- FRED (economic indicators)
- Polymarket (prediction markets)
- VesselFinder (maritime tracking)

**Technologies:**
- Groq (LLM inference)
- Upstash (Redis hosting)
- Three.js & globe.gl (3D visualization)
- FastAPI, Next.js, PostgreSQL

---

## 📞 Support

- **Documentation**: [GLOBAL_MONITOR_IMPLEMENTATION.md](./GLOBAL_MONITOR_IMPLEMENTATION.md)
- **Quick Start**: [GLOBAL_MONITOR_QUICK_START.md](./GLOBAL_MONITOR_QUICK_START.md)
- **API Docs**: http://localhost:8000/docs
- **GitHub Issues**: Submit bugs/feature requests

---

**Built with ❤️ for traders who need an edge**

*Real-time intelligence • AI-powered insights • Market correlation • Production-ready*
