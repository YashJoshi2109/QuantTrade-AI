# 🚀 Start Here - Quick Setup Guide

## ✅ Current Status

- ✅ Python 3.14.2 installed
- ✅ Virtual environment created and activated
- ✅ Core packages installed
- ✅ PostgreSQL 18 running
- ✅ Redis running
- ✅ Database `trading_copilot` created
- ✅ pgvector extension installed
- ✅ Database connection tested and working

## 🎯 Quick Start Commands

### 1. Start Backend

```bash
cd /Users/yash/Downloads/Finance/backend
source venv/bin/activate
uvicorn app.main:app --reload
```

Backend will be available at: **http://localhost:8000**
API docs at: **http://localhost:8000/docs**

### 2. Start Frontend (in a new terminal)

```bash
cd /Users/yash/Downloads/Finance/frontend
npm install  # First time only
npm run dev
```

Frontend will be available at: **http://localhost:3000**

## 📋 Service Status

### Check PostgreSQL:
```bash
brew services list | grep postgresql
# Should show: postgresql@18 started
```

### Check Redis:
```bash
redis-cli ping
# Should return: PONG
```

### Test Database Connection:
```bash
cd backend
source venv/bin/activate
python -c "from app.db.database import engine; print('✅ Connected!')"
```

## 🔧 Configuration

### Database URL (Already Set)
Your `.env` file is configured for local PostgreSQL:
```
DATABASE_URL=postgresql+psycopg://yash@localhost:5432/trading_copilot
```

### API Keys (Optional - Add Later)
Edit `backend/.env` and add:
- `OPENAI_API_KEY` - For Phase 2 AI features
- `ALPHA_VANTAGE_API_KEY` - Optional market data

## 🐛 Troubleshooting

### "command not found: python"
**Solution:** Activate venv first: `source venv/bin/activate`

### "command not found: pip"
**Solution:** Activate venv first: `source venv/bin/activate`

### Database connection errors
**Check:**
1. PostgreSQL is running: `brew services list | grep postgresql`
2. Database exists: `psql -U yash -l | grep trading_copilot`
3. DATABASE_URL in `.env` is correct

### Port already in use
```bash
# Check what's using port 8000 (backend)
lsof -i :8000

# Check what's using port 3000 (frontend)
lsof -i :3000
```

## 📚 Next Steps

1. ✅ Start backend: `uvicorn app.main:app --reload`
2. ✅ Start frontend: `npm run dev`
3. ✅ Test API: Visit http://localhost:8000/docs
4. ✅ Test frontend: Visit http://localhost:3000
5. ⏳ Sync initial data: `python scripts/sync_data.py` (after backend is running)

## 📖 Documentation

- `SETUP.md` - Detailed setup instructions
- `LOCAL_SETUP.md` - Local PostgreSQL/Redis setup
- `DOCKER_SETUP.md` - Docker alternative (if needed)
- `docs/ARCHITECTURE.md` - System architecture
- `docs/PHASES.md` - Development phases

## 🎉 You're Ready!

Everything is set up and ready to go. Just start the backend and frontend servers!
