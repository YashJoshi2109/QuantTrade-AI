# 🚀 QuantTrade AI - AWS EC2 Deployment Guide

This guide walks you through deploying QuantTrade AI on an AWS EC2 instance.

## 📋 Prerequisites

- AWS Account with EC2 access
- Domain name (optional, but recommended for SSL)
- Your existing Neon PostgreSQL database
- API keys (Finnhub, Alpha Vantage, NewsAPI, Anthropic)

---

## 🖥️ Step 1: Launch EC2 Instance

### Recommended Instance Specs

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Instance Type | t3.small | t3.medium |
| vCPUs | 2 | 2 |
| Memory | 2 GB | 4 GB |
| Storage | 20 GB SSD | 30 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

### Launch Steps

1. **Go to EC2 Dashboard** → Click "Launch Instance"

2. **Name**: `quanttrade-ai-production`

3. **AMI**: Ubuntu Server 22.04 LTS (HVM), SSD Volume Type

4. **Instance Type**: `t3.small` or `t3.medium`

5. **Key Pair**: Create or select existing key pair
   - Download the `.pem` file and keep it safe!

6. **Network Settings**:
   - Create security group with these rules:
   
   | Type | Port | Source | Description |
   |------|------|--------|-------------|
   | SSH | 22 | Your IP | SSH access |
   | HTTP | 80 | 0.0.0.0/0 | Web traffic |
   | HTTPS | 443 | 0.0.0.0/0 | Secure web traffic |
   | Custom TCP | 8000 | 0.0.0.0/0 | API (optional) |

7. **Storage**: 30 GB gp3 SSD

8. Click **Launch Instance**

---

## 🔗 Step 2: Connect to Your Instance

```bash
# Set permissions on your key file
chmod 400 your-key.pem

# Connect via SSH
ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

---

## ⚙️ Step 3: Initial Server Setup

### Run the setup script:

```bash
# Clone your repository
cd /var/www
sudo mkdir -p quanttrade
sudo chown ubuntu:ubuntu quanttrade
git clone https://github.com/YashJoshi2109/QuantTrade-AI.git quanttrade

# Run the EC2 setup script
cd quanttrade/deploy
chmod +x *.sh
sudo ./ec2-setup.sh
```

This installs:
- Node.js 20 LTS
- Python 3.11
- nginx
- Redis
- PM2 (process manager)
- Certbot (for SSL)

---

## 🔐 Step 4: Configure Environment Variables

### Backend Environment

```bash
# Copy the template
cp deploy/.env.production.template backend/.env

# Edit with your values
nano backend/.env
```

**Critical values to update:**
```env
# Your Neon database URL (from your local .env)
DATABASE_URL=postgresql://neondb_owner:npg_XXX@ep-XXX.neon.tech/neondb?sslmode=require

# Generate a new JWT secret for production
JWT_SECRET_KEY=$(openssl rand -hex 32)

# Your API keys
FINNHUB_API_KEY=your_key
ALPHA_VANTAGE_API_KEY=your_key
NEWSAPI_KEY=your_key
ANTHROPIC_API_KEY=your_key

# Update CORS for your domain
CORS_ORIGINS=["https://yourdomain.com"]
```

### Frontend Environment

```bash
# Create frontend .env.local
cat > frontend/.env.local << EOF
NEXT_PUBLIC_API_URL=https://yourdomain.com/api/v1
# Or if no domain yet:
# NEXT_PUBLIC_API_URL=http://YOUR_EC2_IP/api/v1
EOF
```

---

## 🚀 Step 5: Deploy the Application

```bash
cd /var/www/quanttrade/deploy
./deploy-app.sh
```

This will:
1. Create Python virtual environment
2. Install Python dependencies
3. Install Node.js dependencies
4. Build the Next.js frontend
5. Start both services with PM2

---

## 🌐 Step 6: Configure Nginx

### Without a domain (IP access only):

```bash
sudo ./setup-nginx.sh
```

### With a domain:

```bash
# First, point your domain's DNS A record to your EC2 public IP
# Then run:
sudo ./setup-nginx.sh yourdomain.com
```

This will:
- Configure nginx as reverse proxy
- Setup SSL certificate (if domain provided)
- Enable automatic certificate renewal

---

## ✅ Step 7: Verify Deployment

### Check services are running:

```bash
# View PM2 processes
pm2 list

# Check logs
pm2 logs

# Monitor resources
pm2 monit
```

### Test endpoints:

```bash
# Health check
curl http://localhost:8000/health

# API test
curl http://localhost:8000/api/v1/market/status

# Frontend (via nginx)
curl http://YOUR_EC2_IP
```

### Access your app:

- **Without domain**: `http://YOUR_EC2_PUBLIC_IP`
- **With domain**: `https://yourdomain.com`

---

## 🔧 Management Commands

### PM2 Process Management

```bash
# View all processes
pm2 list

# View logs
pm2 logs                    # All logs
pm2 logs quanttrade-backend # Backend only
pm2 logs quanttrade-frontend # Frontend only

# Restart services
pm2 restart all
pm2 restart quanttrade-backend
pm2 restart quanttrade-frontend

# Stop services
pm2 stop all

# Monitor
pm2 monit
```

### Update Application

```bash
cd /var/www/quanttrade

# Pull latest changes
git pull origin main

# Reinstall dependencies if needed
cd backend && source venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm ci

# Rebuild frontend
npm run build

# Restart services
pm2 restart all
```

### View Logs

```bash
# Nginx logs
sudo tail -f /var/log/nginx/quanttrade_access.log
sudo tail -f /var/log/nginx/quanttrade_error.log

# Application logs
tail -f /var/log/quanttrade/backend-out.log
tail -f /var/log/quanttrade/backend-error.log
```

---

## 🔒 Security Checklist

- [ ] Change default SSH port (optional)
- [ ] Disable password authentication for SSH
- [ ] Keep system updated: `sudo apt update && sudo apt upgrade`
- [ ] Use strong JWT secret (32+ characters)
- [ ] Enable SSL with Let's Encrypt
- [ ] Restrict security group to necessary ports only
- [ ] Setup automated backups (optional)
- [ ] Configure CloudWatch monitoring (optional)

---

## 🐛 Troubleshooting

### Backend won't start

```bash
# Check logs
pm2 logs quanttrade-backend

# Common issues:
# - Missing .env file
# - Invalid DATABASE_URL
# - Missing API keys
# - Port 8000 already in use
```

### Frontend build fails

```bash
# Check Node.js version
node --version  # Should be 20.x

# Clear cache and rebuild
cd frontend
rm -rf .next node_modules
npm ci
npm run build
```

### Nginx errors

```bash
# Test configuration
sudo nginx -t

# Check error log
sudo tail -f /var/log/nginx/error.log

# Common issues:
# - Upstream server not responding (backend/frontend not running)
# - SSL certificate issues
```

### Database connection issues

```bash
# Test from EC2
cd /var/www/quanttrade/backend
source venv/bin/activate
python -c "from app.db.database import engine; print('OK')"

# Common issues:
# - Wrong DATABASE_URL
# - Neon IP allowlist (check Neon dashboard)
# - SSL mode issues
```

---

## 💰 Cost Estimation

| Resource | Monthly Cost |
|----------|--------------|
| t3.small EC2 | ~$15 |
| t3.medium EC2 | ~$30 |
| 30GB EBS Storage | ~$3 |
| Data Transfer (50GB) | ~$5 |
| **Total (t3.small)** | **~$23/month** |

**Free tier eligible** for the first 12 months (t2.micro)

---

## 📞 Support

If you encounter issues:
1. Check the logs (`pm2 logs`)
2. Verify environment variables
3. Test individual services
4. Check security group rules

Your QuantTrade AI is now live! 🎉
