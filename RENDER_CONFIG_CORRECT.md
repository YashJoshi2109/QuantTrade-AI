# ✅ Correct Render Configuration

## Database URL - Which One to Use?

You have **TWO** databases:

### Option 1: Neon Database (from Netlify)
```
postgresql://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb
```
- **Region**: US East (AWS)
- **Managed by**: Neon/Netlify
- **Already initialized**: ✅ Tables created

### Option 2: Render Database (from Render)
```
postgresql://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```
- **Region**: Oregon (US West)  
- **Managed by**: Render
- **Already initialized**: ✅ Tables created

## 🎯 Recommended: Use Render Database

**Why?**
- ✅ Same network as your Render backend (faster)
- ✅ No external network latency
- ✅ Free tier available
- ✅ Already initialized with all tables

## 📋 Correct Render Environment Variables

In Render → Settings → Environment, set:

```env
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
SECRET_KEY=7730eae563847420772c890ecb062bb7
ANTHROPIC_API_KEY=sk-ant-api03-F8xRWZwmxjuyN-TmbmT4ynjGSrJFiEE3Tri_jLXZ6-_sneJGIYGO147Y4WjU7rLQGreGS4Hbdy5LkVw6ObQw-XSwbLQAA
ALPHA_VANTAGE_API_KEY=UWS40DIIQZGL3BHR
ALLOWED_ORIGINS=https://sunny-hamster-0012a0.netlify.app,http://localhost:3000
```

**Note**: Use **INTERNAL** URL (no `.oregon-postgres.render.com`) when deploying on Render!

## ✅ Render Settings Checklist

### Build & Deploy
- [x] **Root Directory**: `backend`
- [x] **Build Command**: `pip install -r requirements-production.txt`
- [x] **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- [x] **Auto-Deploy**: On (deploys on git push)

### Environment Variables
- [x] `DATABASE_URL` - Render database (internal URL)
- [x] `SECRET_KEY` - JWT secret
- [x] `ANTHROPIC_API_KEY` - Claude API key
- [x] `ALPHA_VANTAGE_API_KEY` - Market data
- [x] `ALLOWED_ORIGINS` - Netlify domain for CORS

## 🔧 Start Command Verification

Your start command is **CORRECT**:
```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

This:
- ✅ Binds to all interfaces (`0.0.0.0`)
- ✅ Uses Render's `$PORT` environment variable
- ✅ Runs the FastAPI app from `app/main.py`

## 📊 Which Database to Use?

| Database | Pros | Cons | Recommended |
|----------|------|------|-------------|
| **Render** | Same network, faster, included | Free tier limits | ✅ **YES** (for Render backend) |
| **Neon** | Good for Netlify serverless | Different network | ❌ Not ideal for Render |

## ✅ Final Answer

**Use Render database for your Render backend:**

```env
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```

**Don't use** the Neon database URL on Render (it's for Netlify serverless functions).

---

**Your configuration is correct!** Start command is good, just use the Render database URL! 🚀
