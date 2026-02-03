# Installation Status

## ✅ Core Requirements Installed Successfully!

All Phase 1 core requirements have been installed:
- FastAPI + Uvicorn
- PostgreSQL driver (psycopg3)
- Database tools (SQLAlchemy, Alembic, pgvector)
- Background jobs (Celery, Redis)
- Data fetching (yfinance, pandas, numpy)
- Technical analysis (ta)
- Authentication (JWT, password hashing)

## Next Steps

### 1. Update Database Connection (Required)
Since we switched from `psycopg2` to `psycopg3`, you need to update the database URL format:

**Old format (psycopg2):**
```
postgresql://user:pass@host:port/dbname
```

**New format (psycopg3):**
```
postgresql+psycopg://user:pass@host:port/dbname
```

Or update `app/db/database.py` to use psycopg3's async connection style.

### 2. Install ML Requirements (Optional - Phase 2+)
When ready for ML features, install separately:

```bash
source venv/bin/activate
pip install -r requirements-ml.txt
```

This will install:
- scikit-learn
- xgboost, lightgbm
- shap
- LangChain + OpenAI
- sentence-transformers
- qdrant-client

**Note:** These may take 20-30 minutes to compile on Python 3.14.

### 3. Test the Installation

```bash
# Start backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload

# Should see:
# INFO:     Uvicorn running on http://127.0.0.1:8000
```

## What Changed

1. **psycopg2 → psycopg3**: Required for Python 3.14 compatibility
2. **Split requirements**: Core vs ML for easier installation
3. **Version constraints**: Added upper bounds to help pip resolve dependencies

## Python 3.14 Compatibility

✅ Working:
- Core web framework (FastAPI)
- Database (psycopg3)
- Data processing (pandas, numpy)
- Background jobs (Celery)

⚠️ May need updates:
- ML packages (will compile from source)
- Some dependencies may need newer versions

## Quick Start

```bash
# 1. Activate venv
cd backend
source venv/bin/activate

# 2. Update .env with database URL (use psycopg format)
# DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/trading_copilot

# 3. Start services
docker-compose up -d  # PostgreSQL + Redis

# 4. Start backend
uvicorn app.main:app --reload
```

## Troubleshooting

If you encounter issues:
1. Check Python version: `python --version` (should be 3.14.2)
2. Verify venv is activated: `which python` (should point to venv)
3. Check installed packages: `pip list`
