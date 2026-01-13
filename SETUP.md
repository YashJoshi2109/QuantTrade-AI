# Setup Guide

## Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL 15+ (or use Docker)
- Git

## Backend Setup

1. **Create virtual environment**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. **Install dependencies**
```bash
pip install -r requirements.txt
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys and database URL
```

4. **Start PostgreSQL** (if using Docker)
```bash
cd ..
docker-compose up -d postgres
```

5. **Run database migrations** (if using Alembic - future)
```bash
# For now, tables are created automatically on startup
```

6. **Sync initial data**
```bash
python scripts/sync_data.py
```

7. **Start the backend server**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`
API docs at `http://localhost:8000/docs`

## Frontend Setup

1. **Install dependencies**
```bash
cd frontend
npm install
```

2. **Set up environment variables** (optional)
```bash
# Create .env.local if needed
NEXT_PUBLIC_API_URL=http://localhost:8000
```

3. **Start development server**
```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`

## Testing the Setup

1. **Backend Health Check**
```bash
curl http://localhost:8000/health
```

2. **Get Symbols**
```bash
curl http://localhost:8000/api/v1/symbols?search=AAPL
```

3. **Get Prices**
```bash
curl http://localhost:8000/api/v1/prices/AAPL
```

4. **Frontend**
   - Open `http://localhost:3000`
   - Search for a symbol (e.g., AAPL)
   - View the chart and indicators

## Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running
- Check DATABASE_URL in `.env`
- Verify database exists: `psql -U postgres -l`

### API Not Responding
- Check backend logs
- Verify port 8000 is not in use
- Check CORS settings if frontend can't connect

### Frontend Build Issues
- Clear `.next` folder: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm install`

### Data Sync Issues
- Check internet connection
- Verify yfinance is working: `python -c "import yfinance; print(yfinance.Ticker('AAPL').info)"`
- Check API rate limits

## Next Steps

1. Complete Phase 1 testing
2. Review the architecture documentation
3. Plan Phase 2 implementation
4. Set up CI/CD (optional)
