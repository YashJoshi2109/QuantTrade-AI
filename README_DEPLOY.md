# QuantTrade AI - Deployment Guide

## Overview

This project uses **Docker + GitHub Actions** for automated push-to-deploy CI/CD. Every push to `main` triggers:

1. **Build** Docker images in GitHub Actions (not on EC2)
2. **Push** images to GitHub Container Registry (GHCR)
3. **Deploy** to EC2 via SSH + docker compose

## Architecture

```
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

## Required GitHub Secrets

Go to **Repository Settings → Secrets and variables → Actions** and add:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `EC2_HOST` | EC2 public IP or hostname | `3.19.207.79` |
| `EC2_USER` | SSH username | `ubuntu` |
| `EC2_SSH_KEY` | Private SSH key (entire content) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

> **Note:** `GITHUB_TOKEN` is automatically provided and has permissions to push to GHCR.

## EC2 Server Setup (One-Time)

SSH into your EC2 instance and run:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Create deployment directory
sudo mkdir -p /opt/quanttrade
sudo chown ubuntu:ubuntu /opt/quanttrade

# Create environment file
sudo nano /opt/quanttrade/.env
```

Add your environment variables to `/opt/quanttrade/.env`:

```env
# Database (Neon Postgres)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# JWT Authentication
JWT_SECRET_KEY=your-super-secret-jwt-key
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PLUS_MONTHLY=price_xxx
STRIPE_PRICE_PLUS_YEARLY=price_xxx

# API Keys
OPENAI_API_KEY=sk-xxx
FINNHUB_API_KEY=xxx
NEWSAPI_KEY=xxx

# Frontend
NEXT_PUBLIC_API_URL=https://quanttrade.us
```

Secure the env file:
```bash
chmod 600 /opt/quanttrade/.env
```

Log out and back in for Docker group permissions to take effect.

## Manual Deployment

If you need to deploy manually:

```bash
cd /opt/quanttrade

# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Start services
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check status
docker ps
```

## Ports

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | Next.js server |
| Backend | 8000 | FastAPI server |

## Adding Nginx + SSL (Optional)

To add Nginx as a reverse proxy with SSL:

```bash
# Install Nginx and Certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# Create Nginx config
sudo nano /etc/nginx/sites-available/quanttrade
```

```nginx
server {
    listen 80;
    server_name quanttrade.us www.quanttrade.us;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/quanttrade /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d quanttrade.us -d www.quanttrade.us
```

## Troubleshooting

### View container logs
```bash
docker compose -f docker-compose.prod.yml logs backend
docker compose -f docker-compose.prod.yml logs frontend
```

### Restart services
```bash
docker compose -f docker-compose.prod.yml restart
```

### Check disk space
```bash
df -h
docker system df
```

### Clean up old images
```bash
docker image prune -af
```

### Force rebuild
```bash
# In GitHub: Actions → Deploy to Production → Run workflow
# Or locally push a commit to main
```

## Rolling Back

To rollback to a previous version:

```bash
# Find previous image tag (SHA)
docker images ghcr.io/yashjoshi2109/quanttrade-backend

# Update docker-compose.prod.yml to use specific SHA tag
# Then:
docker compose -f docker-compose.prod.yml up -d
```

## Security Notes

- Never commit `.env` files to git
- EC2 security group should only expose ports 80, 443, and 22
- Use IAM roles for AWS services when possible
- Rotate secrets periodically
