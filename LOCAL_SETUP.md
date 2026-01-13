# Local Setup Guide (Without Docker)

## ✅ Status

- ✅ PostgreSQL 18 is running
- ✅ Redis is running  
- ✅ Database `trading_copilot` created
- ⚠️ pgvector extension needs installation

## Database Configuration

Your PostgreSQL setup uses your macOS username (`yash`) as the database user, not `postgres`.

**Updated DATABASE_URL in `.env`:**
```
DATABASE_URL=postgresql+psycopg://yash@localhost:5432/trading_copilot
```

## Install pgvector Extension

The pgvector extension allows PostgreSQL to store and query vector embeddings for RAG.

### Option 1: Install via Homebrew (Easiest)

```bash
brew install pgvector
```

Then connect and enable:
```bash
psql -U yash -d trading_copilot -c "CREATE EXTENSION vector;"
```

### Option 2: Build from Source

If Homebrew doesn't have pgvector:
```bash
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
make install
```

Then enable:
```bash
psql -U yash -d trading_copilot -c "CREATE EXTENSION vector;"
```

## Start Services

### PostgreSQL (Already Running)
```bash
# Check status
brew services list | grep postgresql

# Start if needed
brew services start postgresql@18

# Stop if needed
brew services stop postgresql@18
```

### Redis (Already Running)
```bash
# Check status
redis-cli ping  # Should return: PONG

# Start if needed (if installed via Homebrew)
brew services start redis

# Or run directly
redis-server
```

## Test Database Connection

```bash
cd backend
source venv/bin/activate

# Test connection
python -c "from app.db.database import engine; print('✅ Connected!')"
```

## Start Backend

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
```

## Useful Commands

### PostgreSQL
```bash
# Connect to database
psql -U yash -d trading_copilot

# List databases
psql -U yash -l

# List tables
psql -U yash -d trading_copilot -c "\dt"

# Drop and recreate database (if needed)
psql -U yash -d postgres -c "DROP DATABASE IF EXISTS trading_copilot;"
psql -U yash -d postgres -c "CREATE DATABASE trading_copilot;"
```

### Redis
```bash
# Connect to Redis CLI
redis-cli

# Test connection
redis-cli ping

# View all keys
redis-cli KEYS "*"
```

## Troubleshooting

### Database connection fails:
1. Check PostgreSQL is running: `brew services list`
2. Verify DATABASE_URL in `.env` uses correct username (`yash`)
3. Test connection: `psql -U yash -d trading_copilot`

### pgvector extension error:
- Install pgvector: `brew install pgvector`
- Or skip for now - it's only needed for Phase 2 (RAG features)

### Port conflicts:
```bash
# Check what's using port 5432
lsof -i :5432

# Check what's using port 6379
lsof -i :6379
```

## Next Steps

1. ✅ Database created
2. ⏳ Install pgvector (optional for Phase 1)
3. ✅ Start backend: `uvicorn app.main:app --reload`
4. ✅ Start frontend: `cd frontend && npm run dev`
