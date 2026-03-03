# Global Monitor - Deployment Checklist

Use this checklist to track your deployment progress.

---

## Phase 1: Pre-Deployment Setup

### Backend Configuration
- [ ] Add Global Monitor variables to your main **backend/.env** file (see `backend/.env.global-monitor.template` for a reference list)
- [ ] Add **GROQ_API_KEY** (required - sign up at https://console.groq.com/)
- [ ] Add **UPSTASH_REDIS_URL** (required - sign up at https://upstash.com/)
- [ ] Add **ACLED_API_KEY** (recommended - https://developer.acleddata.com/)
- [ ] Add **NASA_FIRMS_API_KEY** (recommended - https://firms.modaps.eosdis.nasa.gov/api/)
- [ ] Add **FRED_API_KEY** (recommended - https://fred.stlouisfed.org/docs/api/api_key.html)
- [ ] Configure **DATABASE_URL** (PostgreSQL connection string)
- [ ] Configure **REDIS_URL** (if different from Upstash)

### Frontend Configuration
- [ ] Create `frontend/.env.local`
- [ ] Set **NEXT_PUBLIC_API_URL** (backend URL, e.g., http://localhost:8000)

### Dependencies
- [ ] Install backend dependencies: `cd backend && pip install -r requirements.txt`
- [ ] Install frontend dependencies: `cd frontend && npm install`
- [ ] Verify PostgreSQL is running and accessible
- [ ] Verify Redis is running (or Upstash is configured)

---

## Phase 2: Database Setup

### Migration
- [ ] Run migration script: `python backend/scripts/migrate_global_monitor.py`
- [ ] Verify 7 tables created:
  - [ ] `global_events`
  - [ ] `threat_classifications`
  - [ ] `ticker_impacts`
  - [ ] `anomaly_detections`
  - [ ] `country_instabilities`
  - [ ] `geographic_clusters`
  - [ ] `data_ingestion_logs`
- [ ] Check indexes created (15+ total)

### Initial Data Ingestion
- [ ] Run ingestion script: `python backend/scripts/ingest_global_monitor.py`
- [ ] Verify events inserted (should see ~50+ from GDELT + USGS)
- [ ] Check database: `psql $DATABASE_URL -c "SELECT COUNT(*) FROM global_events;"`

---

## Phase 3: Backend Testing

### API Server
- [ ] Start backend: `cd backend && uvicorn app.main:app --reload --port 8000`
- [ ] Server starts without errors
- [ ] Access Swagger UI: http://localhost:8000/docs
- [ ] All Global Monitor endpoints visible under "global-monitor" tag

### API Endpoint Testing
- [ ] Test events list: `curl http://localhost:8000/api/v1/monitor/events`
- [ ] Test single event: `curl http://localhost:8000/api/v1/monitor/events/1`
- [ ] Test statistics: `curl http://localhost:8000/api/v1/monitor/stats`
- [ ] Test country instability: `curl http://localhost:8000/api/v1/monitor/country-instability?limit=5`
- [ ] Test hotspots: `curl http://localhost:8000/api/v1/monitor/hotspots`
- [ ] Test ticker impacts: `curl http://localhost:8000/api/v1/monitor/events/1/tickers`
- [ ] All endpoints return valid JSON responses
- [ ] Response times < 200ms for simple queries

### Integration Tests
- [ ] Run test suite: `python backend/tests/test_global_monitor_integration.py`
- [ ] All tests pass (15+ test cases)
- [ ] No errors in output

---

## Phase 4: Frontend Testing

### Development Server
- [ ] Start frontend: `cd frontend && npm run dev`
- [ ] Server starts on http://localhost:3000
- [ ] No console errors in terminal

### Monitor Page
- [ ] Navigate to: http://localhost:3000/monitor
- [ ] Page loads without errors
- [ ] 3D globe renders correctly
- [ ] Event markers visible on globe
- [ ] Event markers colored correctly (🟢🟡🟠🔴)
- [ ] Globe rotates automatically

### Statistics Dashboard
- [ ] Statistics cards display data:
  - [ ] Total Events (should be > 0)
  - [ ] Critical Threats
  - [ ] High Threats
  - [ ] Active Hotspots
  - [ ] Countries Monitored
  - [ ] Affected Tickers
- [ ] Numbers match backend API responses

### Filters
- [ ] Threat Level filter works (ALL, CRITICAL, HIGH, MEDIUM, LOW)
- [ ] Category filter works (ALL, CONFLICT, POLITICAL, DISASTER, ECONOMIC)
- [ ] Time Range filter works (24h, 7d, 30d)
- [ ] Country filter works (ALL or specific countries)
- [ ] Event list updates when filters change

### Event List
- [ ] Events display in table format
- [ ] Threat badges show correct colors
- [ ] Location names visible
- [ ] Timestamps display (e.g., "2 hours ago")
- [ ] Click on event opens Ticker Impact Drawer

### Ticker Impact Drawer
- [ ] Drawer slides in from right when event clicked
- [ ] Event details display correctly
- [ ] Affected tickers list shows stocks/ETFs
- [ ] Sentiment badges display (BULLISH/BEARISH/NEUTRAL)
- [ ] Impact scores visible (0-100)
- [ ] Correlation reasons shown
- [ ] "Add to Watchlist" buttons present
- [ ] Close button works

### Browser Console
- [ ] No JavaScript errors in console
- [ ] No network errors (failed API calls)
- [ ] React warnings resolved (if any)

---

## Phase 5: Background Tasks (Optional for MVP)

### Celery Worker
- [ ] Start Celery worker: `cd backend && celery -A app.tasks worker -l info`
- [ ] Worker starts without errors
- [ ] No import errors for tasks

### Celery Beat (Scheduler)
- [ ] Start Celery beat: `cd backend && celery -A app.tasks beat -l info`
- [ ] Beat scheduler starts
- [ ] Schedule loaded (6 tasks configured)

### Task Execution
- [ ] Wait 5 minutes, verify OpenSky task runs
- [ ] Wait 10 minutes, verify USGS task runs
- [ ] Wait 15 minutes, verify GDELT task runs
- [ ] Check logs for successful sync messages
- [ ] Verify new events in database after syncs
- [ ] No task failures in logs

---

## Phase 6: Performance Testing

### Response Times
- [ ] Events list (100 items): < 150ms
- [ ] Single event detail: < 50ms
- [ ] Ticker correlations: < 100ms
- [ ] Statistics dashboard: < 100ms
- [ ] Country instability: < 150ms

### Load Testing (Optional)
- [ ] Use tool like `wrk` or `ab` to test concurrent requests
- [ ] Backend handles 100 concurrent users without errors
- [ ] Response times stay under 500ms at 50 RPS (requests/sec)

### Database Performance
- [ ] Check query plans for slow queries
- [ ] Verify indexes being used: `EXPLAIN ANALYZE SELECT * FROM global_events WHERE threat_level = 'HIGH';`
- [ ] No full table scans for filtered queries

---

## Phase 7: Production Deployment

### Infrastructure
- [ ] Production server provisioned (EC2, DigitalOcean, etc.)
- [ ] PostgreSQL database set up (or Neon/Supabase)
- [ ] Redis instance running (Upstash, AWS ElastiCache, etc.)
- [ ] SSL certificate obtained (Let's Encrypt)
- [ ] Domain name configured

### Backend Deployment
- [ ] Build Docker image: `docker build -t global-monitor-backend ./backend`
- [ ] Push to registry (Docker Hub, ECR, etc.)
- [ ] Deploy container to production
- [ ] Configure environment variables on server
- [ ] Set up systemd/supervisor for Celery workers
- [ ] Configure Nginx reverse proxy
- [ ] Enable SSL/TLS
- [ ] Test production API endpoints

### Frontend Deployment
- [ ] Build production bundle: `cd frontend && npm run build`
- [ ] Deploy to Vercel/Netlify or self-hosted
- [ ] Configure production API URL
- [ ] Test production frontend loads
- [ ] Verify API calls work from production domain

### CORS Configuration
- [ ] Add production frontend domain to backend CORS origins
- [ ] Test CORS from production frontend
- [ ] Verify OPTIONS preflight requests work

### DNS & SSL
- [ ] Point domain to production server
- [ ] SSL certificate valid and auto-renewing
- [ ] HTTPS enforced (HTTP → HTTPS redirect)

---

## Phase 8: Monitoring & Logging

### Application Monitoring
- [ ] Set up Sentry for error tracking (or similar)
- [ ] Configure log aggregation (CloudWatch, Datadog, etc.)
- [ ] Create alerts for critical errors
- [ ] Set up uptime monitoring (UptimeRobot, Pingdom, etc.)

### Performance Monitoring
- [ ] Enable APM (Application Performance Monitoring)
- [ ] Track API response times
- [ ] Monitor database query performance
- [ ] Set up alerts for slow queries (> 1s)

### Business Metrics
- [ ] Track data ingestion success rate
- [ ] Monitor LLM API usage (Groq)
- [ ] Track ticker correlation generation
- [ ] Monitor Redis hit rate

### Alerts
- [ ] Alert on API endpoint failures (5xx errors)
- [ ] Alert on Celery task failures
- [ ] Alert on data ingestion failures (> 3 consecutive)
- [ ] Alert on high API latency (> 2s avg)
- [ ] Alert on database connection issues

---

## Phase 9: Security Hardening

### Authentication
- [ ] All API endpoints require authentication (except public ones)
- [ ] JWT tokens validated correctly
- [ ] Rate limiting enabled per user
- [ ] API keys stored securely (not in code)

### Database Security
- [ ] Database user has minimum required permissions
- [ ] SSL/TLS enabled for database connections
- [ ] Database password rotated from default
- [ ] Backups encrypted

### API Security
- [ ] CORS restricted to known domains
- [ ] Input validation on all endpoints
- [ ] SQL injection protection (using ORM)
- [ ] XSS protection enabled

### Infrastructure Security
- [ ] Firewall configured (only ports 80/443 open)
- [ ] SSH key-based authentication only
- [ ] Fail2ban or equivalent enabled
- [ ] OS and packages up to date

---

## Phase 10: Documentation & Handoff

### Internal Documentation
- [ ] Update deployment runbook with production specifics
- [ ] Document environment variable meanings
- [ ] Create troubleshooting guide for common issues
- [ ] Document backup/restore procedures

### User Documentation
- [ ] Update README with production URLs
- [ ] Create user guide for Global Monitor features
- [ ] Document API endpoints for integrations
- [ ] Prepare FAQ for support team

### Team Handoff
- [ ] Train team on Global Monitor features
- [ ] Share access to production environments
- [ ] Document on-call procedures
- [ ] Set up support channels (Slack, email, etc.)

---

## Phase 11: Go-Live & Post-Launch

### Pre-Launch
- [ ] Final end-to-end testing in production
- [ ] Verify all external API keys working
- [ ] Test mobile responsiveness
- [ ] Prepare rollback plan

### Launch
- [ ] Enable Global Monitor in production
- [ ] Monitor error logs closely for first 24 hours
- [ ] Track user engagement metrics
- [ ] Collect initial user feedback

### Post-Launch (First Week)
- [ ] Daily monitoring of error rates
- [ ] Review performance metrics
- [ ] Adjust Celery task frequencies if needed
- [ ] Fix any critical bugs discovered
- [ ] Gather user feedback and prioritize improvements

### Post-Launch (First Month)
- [ ] Analyze usage patterns
- [ ] Optimize slow queries
- [ ] Add missing features based on feedback
- [ ] Scale infrastructure if needed
- [ ] Review API costs and optimize

---

## Success Criteria

### Technical
- ✅ **Uptime**: > 99.5% (< 4 hours downtime/month)
- ✅ **Response Time**: P95 < 500ms for all API endpoints
- ✅ **Error Rate**: < 0.5% of requests
- ✅ **Data Freshness**: Events < 30 minutes old

### Business
- ✅ **Event Coverage**: 100+ events/day from multiple sources
- ✅ **Ticker Correlations**: > 20% of events have correlated tickers
- ✅ **User Engagement**: Users spending > 2 min/session on /monitor
- ✅ **Watchlist Adds**: > 5% of viewed tickers added to watchlist

### Data Quality
- ✅ **Classification Accuracy**: > 80% of threat levels reasonable
- ✅ **Correlation Relevance**: > 70% of ticker suggestions useful
- ✅ **Anomaly Detection**: < 5% false positive rate
- ✅ **Geographic Accuracy**: > 95% of events have correct location

---

## Rollback Plan

If critical issues arise, follow this rollback procedure:

1. **Immediate Actions**:
   - [ ] Disable Global Monitor feature flag (if implemented)
   - [ ] Stop Celery workers (prevents new data ingestion)
   - [ ] Redirect /monitor route to maintenance page

2. **Database Rollback** (if schema issues):
   - [ ] Backup current database state
   - [ ] Drop Global Monitor tables
   - [ ] Restore previous database backup
   - [ ] Verify application works without Global Monitor

3. **Code Rollback** (if application issues):
   - [ ] Revert to previous Git commit
   - [ ] Rebuild Docker images
   - [ ] Deploy previous version
   - [ ] Verify core functionality restored

4. **Communication**:
   - [ ] Notify users via email/in-app message
   - [ ] Update status page
   - [ ] Post-mortem document started

---

## Troubleshooting Quick Reference

### Issue: No events in database
**Solution**: 
```bash
cd backend
python scripts/ingest_global_monitor.py
```

### Issue: Globe not rendering
**Solution**: Check browser console for Three.js errors, verify globe.gl installed

### Issue: API returns 500 errors
**Solution**: Check Redis connection (`redis-cli ping`), verify Groq API key

### Issue: Ticker drawer empty
**Solution**: 
```bash
cd backend
python -c "from app.tasks.global_monitor_tasks import correlate_tickers; correlate_tickers()"
```

### Issue: Celery tasks not running
**Solution**: Check Celery logs, verify Redis broker URL, restart workers

---

## Completion Date: _______________

**Deployed By**: _______________

**Production URL**: _______________

**Verified By**: _______________

---

**🎉 Congratulations! Global Monitor is now live!**
