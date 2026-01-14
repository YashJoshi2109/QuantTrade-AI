# Production Deployment Guide

## Your Production URLs

- **Frontend**: https://sunny-hamster-0012a0.netlify.app/
- **Database**: Neon PostgreSQL (configured via Netlify)

## Step 1: Initialize Database

### Connect to Neon Database

```bash
psql 'postgresql://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
```

### Initialize Tables

```bash
cd backend
source venv/bin/activate
python scripts/init_database.py
```

This will create all necessary tables:
- `users` - User accounts
- `symbols` - Stock symbols
- `price_bars` - Price data
- `news_articles` - News articles
- `filings` - SEC filings
- `filing_chunks` - Filing chunks for RAG
- `watchlists` - User watchlists

## Step 2: Deploy Backend

### Option A: Railway (Recommended)

1. Go to https://railway.app
2. New Project → Deploy from GitHub
3. Select your repository
4. Set root directory: `backend`
5. Add environment variables (see below)

### Option B: Render

1. Go to https://render.com
2. New → Web Service
3. Connect GitHub repository
4. Set root directory: `backend`
5. Build command: `pip install -r requirements.txt`
6. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Backend Environment Variables

Add these in your backend hosting platform:

```env
# Database (use Netlify's Neon database)
DATABASE_URL=postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require

# JWT Secret (generate a strong one!)
SECRET_KEY=your-super-secret-production-key-here-generate-with-python-secrets-token_urlsafe-32

# API Keys
ANTHROPIC_API_KEY=your-anthropic-key
ALPHA_VANTAGE_API_KEY=your-alpha-vantage-key

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# CORS (your Netlify domain)
ALLOWED_ORIGINS=https://sunny-hamster-0012a0.netlify.app,http://localhost:3000
```

### Generate Production Secret Key

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Step 3: Configure Netlify Frontend

### Environment Variables in Netlify

Go to Netlify → Site settings → Environment variables:

```env
# Your backend API URL (from Railway/Render)
NEXT_PUBLIC_API_URL=https://your-backend.railway.app

# Google OAuth
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### Update Google OAuth Settings

In Google Cloud Console, update your OAuth client:

**Authorized JavaScript origins:**
```
https://sunny-hamster-0012a0.netlify.app
```

**Authorized redirect URIs:**
```
https://sunny-hamster-0012a0.netlify.app/auth/callback
```

## Step 4: Verify Database Connection

### Test Connection

```bash
cd backend
source venv/bin/activate
python -c "
from app.db.database import engine
from sqlalchemy import text
with engine.connect() as conn:
    result = conn.execute(text('SELECT version()'))
    print('✅ Database connected:', result.fetchone()[0][:50])
"
```

### Initialize Tables

```bash
python scripts/init_database.py
```

## Step 5: Sync Initial Data

```bash
# Sync stock symbols
python scripts/sync_data.py

# Sync news and filings (optional, can be done via API)
python scripts/sync_news_filings.py
```

## Step 6: Test Production

### Test Frontend
1. Visit https://sunny-hamster-0012a0.netlify.app/
2. Check console for errors
3. Test navigation

### Test Authentication
1. Click "Sign In / Register"
2. Register a new account
3. Verify user is created in database
4. Test login
5. Test Google OAuth (if configured)

### Test API
```bash
# Health check
curl https://your-backend.railway.app/health

# Register user
curl -X POST https://your-backend.railway.app/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "testpass123",
    "full_name": "Test User"
  }'

# Login
curl -X POST https://your-backend.railway.app/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpass123"
  }'
```

## Step 7: Verify Database Storage

### Check Users Table

```bash
psql 'postgresql://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

# In psql:
\dt                    # List all tables
SELECT * FROM users;   # Check registered users
SELECT * FROM watchlists;  # Check watchlists
```

## Production Checklist

### Backend
- [ ] Backend deployed to Railway/Render
- [ ] Database URL configured
- [ ] SECRET_KEY set (strong random key)
- [ ] API keys configured
- [ ] CORS allows Netlify domain
- [ ] Database tables initialized
- [ ] Health endpoint working

### Frontend
- [ ] Deployed to Netlify
- [ ] NEXT_PUBLIC_API_URL points to backend
- [ ] Google OAuth configured
- [ ] Environment variables set
- [ ] Build succeeds

### Database
- [ ] Connected to Neon PostgreSQL
- [ ] Tables created
- [ ] Can insert/query data
- [ ] Users can register/login
- [ ] Data persists

### Authentication
- [ ] Registration works
- [ ] Login works
- [ ] Google OAuth works (if configured)
- [ ] JWT tokens generated
- [ ] Protected routes work
- [ ] User data stored in database

## Troubleshooting

### Database Connection Issues

```bash
# Test connection string
psql 'postgresql://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

# If connection fails, check:
# 1. Network connectivity
# 2. SSL mode requirements
# 3. Credentials are correct
```

### CORS Errors

Make sure backend `ALLOWED_ORIGINS` includes:
```
https://sunny-hamster-0012a0.netlify.app
```

### API Not Working

1. Check backend is running
2. Verify `NEXT_PUBLIC_API_URL` is correct
3. Check browser console for errors
4. Test backend directly with curl

### Authentication Not Working

1. Check SECRET_KEY is set
2. Verify database connection
3. Check users table exists
4. Test registration endpoint directly

## Quick Commands

```bash
# Initialize database
cd backend && python scripts/init_database.py

# Test database connection
python -c "from app.db.database import engine; engine.connect(); print('✅ Connected')"

# Generate secret key
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Check tables
psql 'your-connection-string' -c "\dt"
```

## Support

- Netlify: https://docs.netlify.com
- Neon: https://neon.tech/docs
- Railway: https://docs.railway.app
- Render: https://render.com/docs
