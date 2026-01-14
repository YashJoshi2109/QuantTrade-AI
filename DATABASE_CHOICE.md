# 🗄️ Database Choice - Neon vs Render

## Your Current Situation

You have **TWO** PostgreSQL databases set up:

### 1. Neon Database (from Netlify integration)
```
postgresql://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb
```
- **Provider**: Neon (via Netlify)
- **Region**: US East (AWS)
- **Tables**: ✅ Initialized
- **Shown in**: Netlify environment variables

### 2. Render Database (from Render PostgreSQL)
```
postgresql://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```
- **Provider**: Render
- **Region**: Oregon (US West)
- **Tables**: ✅ Initialized
- **Shown in**: Render dashboard

## ✅ Recommended: Use Render Database

**For Render backend deployment, use the Render database.**

### Why?
- ✅ **Same network** - Backend and database both on Render (faster, lower latency)
- ✅ **No cross-provider traffic** - Stays within Render infrastructure
- ✅ **Internal URL available** - Even faster connection
- ✅ **Free tier** - Included with Render free plan
- ✅ **Already initialized** - All tables created

### Render Environment Variable
```env
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```

**Important**: Use the **INTERNAL** URL (no `.oregon-postgres.render.com`) for best performance!

## ⚠️ Neon Database - When to Use

Use Neon database if:
- You're deploying backend to Netlify Functions (serverless)
- You want global CDN edge database
- You prefer Neon's features (branching, etc.)

For standard Render deployment: **Use Render database**

## 🎯 Current Configuration

Your `backend/app/config.py` is set to:
```python
_db_url = (
    os.getenv("DATABASE_URL", "") or 
    os.getenv("RENDER_DATABASE_URL", "") or 
    os.getenv("NETLIFY_DATABASE_URL", "")
)

# Default: Render database
if not _db_url:
    _db_url = "postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com/finance_r6b5"
```

This is **CORRECT** - it will use whichever `DATABASE_URL` you set in Render environment variables.

## ✅ What to Do

In **Render → Settings → Environment**, set:
```env
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```

**Use INTERNAL URL (without `.oregon-postgres.render.com`)** for Render services!

---

**Use Render database for Render backend!** 🚀
