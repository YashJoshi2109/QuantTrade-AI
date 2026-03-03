# Global Monitor - Quick Start Guide

## 🚀 Get Running in 15 Minutes

This guide gets the Global Monitor feature running with minimal configuration. We'll use free API tiers for everything.

---

## Prerequisites

✅ PostgreSQL database running  
✅ Redis installed (or Upstash account)  
✅ Python 3.10+ installed  
✅ Node.js 18+ installed  

---

## Step 1: Backend Setup (5 minutes)

### 1.1 Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 1.2 Configure Critical API Keys

**Add these variables to your main backend `.env` file** (in `backend/`). The app reads all API keys from this single `.env` file.

**Add these 2 CRITICAL keys to `backend/.env`:**

```bash
# 1. Groq API (AI threat classification) - REQUIRED
# Sign up: https://console.groq.com/ (Free tier: 14,400 requests/day)
GROQ_API_KEY=gsk_your_key_here

# 2. Upstash Redis (Caching) - REQUIRED
# Sign up: https://upstash.com/ (Free tier: 10,000 commands/day)
UPSTASH_REDIS_URL=redis://default:your_token@redis-12345.upstash.io:6379
REDIS_URL=${UPSTASH_REDIS_URL}
```

**Optional but recommended (all free):**

```bash
# ACLED (Conflict data)
# Sign up: https://developer.acleddata.com/
ACLED_API_KEY=your_key_here
ACLED_EMAIL=your_email@example.com

# NASA FIRMS (Fire/disaster tracking)
# Sign up: https://firms.modaps.eosdis.nasa.gov/api/
NASA_FIRMS_API_KEY=your_key_here

# FRED (Economic data)
# Sign up: https://fred.stlouisfed.org/docs/api/api_key.html
FRED_API_KEY=your_key_here
```

**Free APIs (no key needed):**
- GDELT (news events) ✅ Works out of the box
- USGS (earthquakes) ✅ Works out of the box
- NASA EONET (natural disasters) ✅ Works out of the box

### 1.3 Create Database Tables

```bash
python scripts/migrate_global_monitor.py
```

Expected output:
```
✅ Successfully created tables:
   - global_events
   - threat_classifications
   - ticker_impacts
   ...
```

### 1.4 Ingest Sample Data

```bash
python scripts/ingest_global_monitor.py
```

This will fetch real data from GDELT and USGS (no API keys needed) and populate the database.

Expected output:
```
📰 Fetching GDELT news events...
  ✅ GDELT: 42 inserted, 8 skipped
🌍 Fetching USGS earthquake data...
  ✅ USGS: 15 inserted, 0 skipped
📊 Calculating country instability indices...
  ✅ Updated instability for 12 countries
🗺️  Detecting geographic clusters...
  ✅ Detected 8 clusters (3 hotspots)
```

### 1.5 Start Backend Server

```bash
uvicorn app.main:app --reload --port 8000
```

Test the API:
```bash
curl http://localhost:8000/api/v1/monitor/stats
```

Expected response:
```json
{
  "total_events": 57,
  "critical_threats": 3,
  "high_threats": 12,
  "active_hotspots": 3,
  "countries_monitored": 12,
  "affected_tickers": 0
}
```

---

## Step 2: Frontend Setup (3 minutes)

### 2.1 Install Dependencies

```bash
cd frontend
npm install
```

### 2.2 Configure API URL

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 2.3 Start Frontend

```bash
npm run dev
```

Open browser: **http://localhost:3000/monitor**

---

## Step 3: Verify It's Working (2 minutes)

### ✅ Backend Health Check

```bash
# Check API endpoints
curl http://localhost:8000/api/v1/monitor/events | jq '.data | length'
# Should return: 57 (or similar number)

curl http://localhost:8000/api/v1/monitor/hotspots
# Should return geographic clusters

curl http://localhost:8000/api/v1/monitor/country-instability?limit=5
# Should return country risk indices
```

### ✅ Frontend Verification

Navigate to: http://localhost:3000/monitor

**You should see:**
- 🌍 **3D Globe** with event markers (colored by threat level)
- 📊 **Statistics Dashboard** showing event counts
- 🔍 **Filter Controls** (threat level, event type, time range)
- 📋 **Event List** with titles, locations, threat badges
- 🎯 **Click any event** → Opens Ticker Impact Drawer

**Test the Killer Feature:**
1. Click on any HIGH or CRITICAL threat event
2. Ticker Impact Drawer should slide in from right
3. See list of affected stocks/ETFs with BULLISH/BEARISH/NEUTRAL badges
4. Test "Add to Watchlist" button

---

## Step 4: Enable Background Sync (Optional)

For real-time monitoring, run Celery workers:

### 4.1 Start Celery Worker

```bash
cd backend
celery -A app.tasks worker -l info
```

### 4.2 Start Celery Beat (Scheduler)

In a new terminal:

```bash
cd backend
celery -A app.tasks beat -l info
```

**Background tasks will now run automatically:**
- OpenSky flights: Every 5 minutes
- GDELT news: Every 15 minutes
- USGS earthquakes: Every 10 minutes
- ACLED conflicts: Every 30 minutes (if API key configured)
- Derived metrics: Every 1 hour
- Ticker correlations: Every 30 minutes

---

## Troubleshooting

### Issue: "No events showing on globe"

**Solution:**
```bash
# Re-run data ingestion
cd backend
python scripts/ingest_global_monitor.py

# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM global_events;"
```

### Issue: "API returns 500 error"

**Solution:**
```bash
# Check backend logs
cd backend
tail -f logs/app.log  # or check console output

# Common causes:
# 1. Missing GROQ_API_KEY
# 2. Redis not running
# 3. Database connection issue

# Verify Redis connection:
redis-cli ping
# Should return: PONG
```

### Issue: "Globe not rendering"

**Solution:**
```bash
# Check browser console for errors
# Common causes:
# 1. CORS issue (backend not allowing frontend origin)
# 2. Three.js/globe.gl loading issue

# Fix CORS in backend/app/main.py:
# Ensure origins includes "http://localhost:3000"
```

### Issue: "Ticker Impact Drawer shows 'No correlations found'"

**Solution:**
```bash
# Run ticker correlation manually
cd backend
python -c "
from app.tasks.global_monitor_tasks import correlate_tickers
correlate_tickers()
"

# Check if ticker_impacts table has data:
psql $DATABASE_URL -c "SELECT COUNT(*) FROM ticker_impacts;"
```

---

## Next Steps

### 🎨 Customize the Globe

Edit `/frontend/src/components/GlobalMonitorGlobe.tsx`:

```typescript
// Change globe textures
globeEl.globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg');

// Adjust marker height
.pointAltitude(d => d.threat_level === 'CRITICAL' ? 0.3 : 0.1)

// Change rotation speed
globeEl.controls().autoRotate = true;
globeEl.controls().autoRotateSpeed = 2.0;
```

### 📊 Add More Data Sources

Enable additional fetchers in Celery tasks:

```python
# backend/app/tasks/global_monitor_tasks.py

@shared_task(name="sync_nasa_firms")
def sync_nasa_firms():
    """Sync fire data from NASA FIRMS"""
    # Implementation already exists in global_monitor_fetchers.py
    pass

@shared_task(name="sync_cloudflare_radar")
def sync_cloudflare_radar():
    """Sync cyber threats from Cloudflare Radar"""
    pass
```

### 🔔 Add Real-Time Alerts

Create WebSocket endpoint for live event stream:

```python
# backend/app/api/global_monitor.py

@router.websocket("/ws/events")
async def event_stream(websocket: WebSocket):
    await websocket.accept()
    # Implement event streaming logic
```

### 🎯 Improve Ticker Correlation

Fine-tune correlation rules in `/backend/app/services/ticker_correlation.py`:

```python
# Add custom correlation rules
if "semiconductor" in event_title.lower() and country_code == "TW":
    correlations.append({
        "symbol": "TSM",
        "impact_score": 90,
        "correlation_confidence": 0.95,
        "impact_sentiment": "BEARISH"
    })
```

---

## API Endpoints Reference

### Events
- `GET /api/v1/monitor/events` - List all events (with filters)
- `GET /api/v1/monitor/events/{id}` - Get single event
- `GET /api/v1/monitor/events/{id}/tickers` - Get affected stocks

### Threats & Analysis
- `GET /api/v1/monitor/threats` - Threat classifications
- `GET /api/v1/monitor/anomalies` - Statistical anomalies
- `GET /api/v1/monitor/country-instability` - Country risk index
- `GET /api/v1/monitor/hotspots` - Geographic clusters

### Statistics
- `GET /api/v1/monitor/stats` - Dashboard statistics

### Data Management
- `POST /api/v1/monitor/sync` - Trigger manual sync
- `GET /api/v1/monitor/ingestion-logs` - View sync history

---

## Performance Optimization

### Database Indexing

Already configured in models, but verify:

```sql
-- Check indexes
SELECT tablename, indexname FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename LIKE 'global_%';

-- Expected indexes:
-- idx_global_events_timestamp
-- idx_global_events_threat_level
-- idx_global_events_category
-- idx_global_events_country
-- idx_ticker_impacts_event
-- idx_ticker_impacts_symbol
```

### Redis Caching

Implement caching for expensive queries:

```python
# backend/app/api/global_monitor.py

@router.get("/events")
async def list_events(...):
    cache_key = f"events:{threat_level}:{category}:{time_range}"
    
    # Check cache
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # Fetch from DB
    events = db.query(GlobalEvent).filter(...).all()
    
    # Cache for 5 minutes
    await redis.setex(cache_key, 300, json.dumps(events))
    
    return events
```

### Frontend Optimization

```typescript
// Use React Query caching
const { data: events } = useQuery({
  queryKey: ['events', filters],
  queryFn: () => fetchGlobalEvents(filters),
  staleTime: 5 * 60 * 1000, // 5 minutes
  cacheTime: 30 * 60 * 1000, // 30 minutes
});
```

---

## Production Deployment Checklist

- [ ] Configure all API keys in production `.env`
- [ ] Set up Redis (Upstash or self-hosted)
- [ ] Enable SSL/TLS for API endpoints
- [ ] Configure CORS for production frontend domain
- [ ] Set up Celery workers with systemd/supervisor
- [ ] Enable database backups
- [ ] Set up monitoring (Sentry, Datadog, etc.)
- [ ] Configure rate limiting per user
- [ ] Enable API authentication for all endpoints
- [ ] Set up CDN for globe textures
- [ ] Configure log rotation
- [ ] Set up alerts for API failures
- [ ] Test disaster recovery procedures

---

## Getting API Keys (Free Tiers)

### Groq (REQUIRED)
1. Visit: https://console.groq.com/
2. Sign up with GitHub/Google
3. Go to API Keys → Create API Key
4. Copy key (starts with `gsk_...`)
5. Free tier: 14,400 requests/day (Llama 3.1 70B)

### Upstash Redis (REQUIRED)
1. Visit: https://upstash.com/
2. Sign up with GitHub/Google
3. Create Database → Select free tier
4. Copy Redis URL and token
5. Free tier: 10,000 commands/day

### ACLED (Recommended)
1. Visit: https://developer.acleddata.com/
2. Sign up for developer account
3. Verify email
4. Get API key from dashboard
5. Free tier: 2,500 requests/month

### NASA FIRMS (Recommended)
1. Visit: https://firms.modaps.eosdis.nasa.gov/api/
2. Request API key (instant approval)
3. Enter email
4. Check email for key
5. Free tier: Unlimited

### FRED (Recommended)
1. Visit: https://fred.stlouisfed.org/docs/api/api_key.html
2. Sign up for FRED account
3. Request API key
4. Key delivered instantly
5. Free tier: Unlimited

---

## Support & Resources

- **Documentation**: `/docs/GLOBAL_MONITOR_IMPLEMENTATION.md`
- **API Schema**: http://localhost:8000/docs (Swagger UI)
- **Example API Calls**: `/backend/tests/test_global_monitor.py`
- **Frontend Components**: `/frontend/src/components/`
- **GitHub Issues**: Submit bugs/feature requests

---

## Estimated Timeline to Production

| Phase | Duration | Description |
|-------|----------|-------------|
| **Phase 1** | Day 1 | Core setup (following this guide) |
| **Phase 2** | Days 2-3 | Configure all API keys, test data ingestion |
| **Phase 3** | Days 4-7 | Customize UI, tune ticker correlations |
| **Phase 4** | Week 2 | Add real-time WebSockets, optimize performance |
| **Phase 5** | Week 3 | User testing, bug fixes, refinements |
| **Phase 6** | Week 4 | Production deployment, monitoring setup |

**Total**: ~1 month to production-ready system

---

## Success Metrics

After completing this guide, you should have:

✅ **Backend**: 
- 7 database tables created
- 10+ API endpoints responding
- 50+ events ingested from free sources
- Threat classification working (via Groq)
- Country instability indices calculated

✅ **Frontend**:
- 3D globe rendering with events
- Event list with filters
- Ticker Impact Drawer functional
- Statistics dashboard showing metrics

✅ **Integration**:
- Backend ↔ Frontend API calls working
- Ticker correlations generated
- Geographic clustering detected
- Real-time data sync (if Celery configured)

---

**🎉 Congratulations! Your Global Monitor is now running!**

Navigate to http://localhost:3000/monitor and explore the live global event feed.
