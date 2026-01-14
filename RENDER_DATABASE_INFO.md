# 📊 Render Database Connection Info

## ✅ Database Initialized

Your Render PostgreSQL database has been successfully initialized with all tables!

## 🔗 Connection Strings

### External Database URL (Local Development)
```
postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com/finance_r6b5
```

**Use for:**
- Local development
- Running scripts from your machine
- Testing database connection locally

### Internal Database URL (Render Services)
```
postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```

**Use for:**
- Backend deployed on Render
- Render services auto-detect this when linked
- Faster connection (same network)

## 📋 Database Details

- **Name**: `finance_r6b5`
- **User**: `finance_r6b5_user`
- **Host**: `dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com` (external)
- **Port**: `5432`
- **Region**: Oregon (US West)
- **PostgreSQL Version**: 18.1

## ✅ Tables Created

All 7 tables are ready:
- ✅ `users` - User accounts
- ✅ `symbols` - Stock symbols
- ✅ `price_bars` - Price data
- ✅ `news_articles` - News articles
- ✅ `filings` - SEC filings
- ✅ `filing_chunks` - Filing chunks for RAG
- ✅ `watchlists` - User watchlists

## 🔧 For Backend Deployment

When deploying backend to Render, set this environment variable:

```env
DATABASE_URL=postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5
```

**Important**: Use the **INTERNAL** URL (without `.oregon-postgres.render.com`) when deploying on Render!

## 🧪 Test Connection

### From Terminal
```bash
psql "postgresql://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com/finance_r6b5"
```

### From Python
```python
from app.db.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text("SELECT version()"))
    print("✅ Connected:", result.fetchone()[0])
```

## 📝 Notes

- Database expires on **February 12, 2026** (free tier)
- Upgrade to keep database permanently
- All data is stored in this Render database
- Backend will auto-connect when deployed on Render

---

**Database is ready for production!** 🎉
