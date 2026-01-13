# Docker Setup Guide

## Option 1: Install Docker Desktop (Recommended)

### Install Docker Desktop for Mac:

1. **Download Docker Desktop:**
   ```bash
   # Visit: https://www.docker.com/products/docker-desktop/
   # Or install via Homebrew:
   brew install --cask docker
   ```

2. **Start Docker Desktop:**
   - Open Docker Desktop from Applications
   - Wait for it to start (whale icon in menu bar)

3. **Verify installation:**
   ```bash
   docker --version
   docker compose version
   ```

4. **Start services:**
   ```bash
   cd /Users/yash/Downloads/Finance
   docker compose up -d
   ```

## Option 2: Install PostgreSQL & Redis Locally (No Docker)

### Install PostgreSQL:

```bash
# Install PostgreSQL via Homebrew
brew install postgresql@15

# Start PostgreSQL service
brew services start postgresql@15

# Create database
createdb trading_copilot

# Or connect and create manually
psql postgres
CREATE DATABASE trading_copilot;
\q
```

### Install Redis:

```bash
# Install Redis via Homebrew
brew install redis

# Start Redis service
brew services start redis

# Verify it's running
redis-cli ping  # Should return: PONG
```

### Update .env file:

```bash
# In backend/.env, update DATABASE_URL if needed
# Default should work: postgresql+psycopg://postgres:postgres@localhost:5432/trading_copilot
```

## Option 3: Use Docker Compose V2 Syntax

If Docker is installed but `docker-compose` command doesn't work, try:

```bash
# Docker Compose V2 uses 'docker compose' (no hyphen)
docker compose up -d
```

## Quick Start (After Docker is Installed)

```bash
# 1. Start services
cd /Users/yash/Downloads/Finance
docker compose up -d

# 2. Check status
docker compose ps

# 3. View logs
docker compose logs

# 4. Stop services
docker compose down
```

## Troubleshooting

### Docker Desktop won't start:
- Check System Preferences > Security & Privacy
- Ensure virtualization is enabled in BIOS/UEFI

### Port already in use:
```bash
# Check what's using port 5432 (PostgreSQL)
lsof -i :5432

# Check what's using port 6379 (Redis)
lsof -i :6379
```

### Database connection errors:
- Ensure PostgreSQL is running: `brew services list`
- Check DATABASE_URL in `.env` file
- Try: `psql -U postgres -d trading_copilot` to test connection
