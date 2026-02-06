# QuantTrade AI - Deployment Guide

## Overview

This project uses **Docker + GitHub Actions** for automated push-to-deploy CI/CD with Nginx reverse proxy.

### Architecture

```
                    PRODUCTION (EC2)
┌─────────────────────────────────────────────────────┐
│                                                     │
│   ┌─────────┐    ┌──────────┐    ┌──────────┐     │
│   │  Nginx  │───▶│ Frontend │    │ Backend  │     │
│   │  :80    │    │  :3000   │    │  :8000   │     │
│   │  :443   │───▶│ (Next.js)│    │ (FastAPI)│     │
│   └─────────┘    └──────────┘    └──────────┘     │
│        │                              ▲           │
│        └───── /api/* ─────────────────┘           │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Git Push      │────▶│  GitHub Actions  │────▶│     EC2         │
│   to main       │     │  Build & Push    │     │  Docker Pull    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  GitHub Container │
                        │  Registry (GHCR)  │
                        └──────────────────┘
```

---

## 🏠 Local Development with Docker

### Quick Start

1. **Copy environment template:**
   ```bash
   cp .env.development.template .env.development
   ```

2. **Edit `.env.development`** with your actual values (API keys, database URL, etc.)

3. **Start services:**
   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

4. **Access the app:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

### Development Commands

```bash
# Start in background
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f

# View specific service logs
docker compose -f docker-compose.dev.yml logs -f backend

# Restart a service
docker compose -f docker-compose.dev.yml restart backend

# Stop all
docker compose -f docker-compose.dev.yml down

# Rebuild after code changes
docker compose -f docker-compose.dev.yml up --build
```

### Without Docker (Native)

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

---

## 🚀 Production Deployment

### Required GitHub Secrets

Go to **Repository Settings → Secrets and variables → Actions** and add:

| Secret Name | Description | Value |
|-------------|-------------|-------|
| `EC2_HOST` | EC2 Elastic IP | `3.19.207.79` |
| `EC2_USER` | SSH username | `ubuntu` |
| `EC2_SSH_KEY` | Private SSH key content | (full key file content) |

### EC2 Initial Setup (One-Time)

SSH into your EC2 instance:

```bash
ssh -i your-key.pem ubuntu@3.19.207.79
```

#### 1. Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Logout and login again for docker group
exit
```

#### 2. Create Deployment Directory

```bash
ssh -i your-key.pem ubuntu@3.19.207.79

sudo mkdir -p /opt/quanttrade/nginx
sudo chown -R ubuntu:ubuntu /opt/quanttrade
```

#### 3. Create Environment File

```bash
nano /opt/quanttrade/.env
```

Add your production secrets:

```env
# Database (Neon Postgres)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# JWT Authentication
JWT_SECRET_KEY=your-production-jwt-secret
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Application URL (for Stripe redirects)
APP_URL=https://www.quanttrade.us
ALLOWED_ORIGINS=https://www.quanttrade.us,https://quanttrade.us

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PLUS_MONTHLY=price_xxx
STRIPE_PRICE_PLUS_YEARLY=price_xxx

# API Keys
OPENAI_API_KEY=sk-xxx
FINNHUB_API_KEY=xxx
NEWSAPI_KEY=xxx

# Frontend
NEXT_PUBLIC_API_URL=https://www.quanttrade.us
```

Secure the file:
```bash
chmod 600 /opt/quanttrade/.env
```

#### 4. Setup SSL Certificates (Let's Encrypt)

**Before first Docker deployment**, get SSL certs:

```bash
# Install certbot
sudo apt install certbot -y

# Stop any services using port 80
sudo systemctl stop nginx 2>/dev/null || true

# Get certificates (standalone mode)
sudo certbot certonly --standalone \
  -d quanttrade.us \
  -d www.quanttrade.us \
  --email your@email.com \
  --agree-tos \
  --no-eff-email

# Verify certs exist
ls -la /etc/letsencrypt/live/quanttrade.us/
```

#### 5. Setup Certificate Auto-Renewal

```bash
# Create renewal script
sudo nano /opt/quanttrade/renew-certs.sh
```

Add:
```bash
#!/bin/bash
cd /opt/quanttrade
docker compose -f docker-compose.prod.yml stop nginx
certbot renew --quiet
docker compose -f docker-compose.prod.yml start nginx
```

```bash
# Make executable
sudo chmod +x /opt/quanttrade/renew-certs.sh

# Add cron job (runs twice daily)
(crontab -l 2>/dev/null; echo "0 0,12 * * * /opt/quanttrade/renew-certs.sh") | crontab -
```

### Manual Deployment

If you need to deploy without GitHub Actions:

```bash
cd /opt/quanttrade

# Login to GHCR
echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Start services
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check status
docker ps
```

---

## 📊 Service Ports

| Service | Internal Port | External Access |
|---------|---------------|-----------------|
| Nginx | 80, 443 | Public (via EC2 security group) |
| Frontend | 3000 | Via Nginx only |
| Backend | 8000 | Via Nginx only (/api/*) |

---

## 🔧 Troubleshooting

### View Container Logs
```bash
docker compose -f docker-compose.prod.yml logs nginx
docker compose -f docker-compose.prod.yml logs backend
docker compose -f docker-compose.prod.yml logs frontend
```

### Restart Services
```bash
docker compose -f docker-compose.prod.yml restart
```

### Check Disk Space
```bash
df -h
docker system df
```

### Clean Up Old Images
```bash
docker image prune -af
docker volume prune -f
```

### SSL Certificate Issues

If Nginx fails to start due to SSL:

```bash
# Check if certs exist
ls -la /etc/letsencrypt/live/quanttrade.us/

# Regenerate if needed
sudo certbot certonly --standalone \
  -d quanttrade.us \
  -d www.quanttrade.us
```

### Container Health Check
```bash
# Check if services are healthy
docker inspect --format='{{.State.Health.Status}}' quanttrade-backend
docker inspect --format='{{.State.Health.Status}}' quanttrade-frontend
```

### Force Rebuild
```bash
# Pull fresh images
docker compose -f docker-compose.prod.yml pull

# Force recreate containers
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

---

## 🔙 Rolling Back

To rollback to a previous version:

```bash
# List available image tags
docker images ghcr.io/yashjoshi2109/quanttrade-backend

# Edit docker-compose.prod.yml to use specific SHA tag instead of :latest
# Then:
docker compose -f docker-compose.prod.yml up -d
```

---

## 🔒 Security Notes

- Never commit `.env` files to git
- EC2 security group should only expose ports **22, 80, 443**
- SSL certificates auto-renew via certbot cron
- JWT secrets should be strong (32+ characters)
- Use Stripe webhook signature verification
- Keep Docker images updated
