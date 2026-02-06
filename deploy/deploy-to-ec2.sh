#!/bin/bash
# ============================================================================
# QuantTrade AI - Full EC2 Deployment Script
# Run from your local machine (Mac)
# ============================================================================

set -e

# Configuration
EC2_HOST="ubuntu@ec2-18-117-248-103.us-east-2.compute.amazonaws.com"
KEY_FILE="$HOME/Downloads/texas-yash-admin-mbp.pem"
LOCAL_PROJECT="/Users/yash/Downloads/Finance"
REMOTE_DIR="/var/www/quanttrade"

echo "============================================"
echo "  🚀 QuantTrade AI - EC2 Deployment"
echo "============================================"
echo "  Host: $EC2_HOST"
echo "  Key:  $KEY_FILE"
echo "============================================"

# SSH command shortcut
SSH_CMD="ssh -i $KEY_FILE -o StrictHostKeyChecking=no $EC2_HOST"
SCP_CMD="scp -i $KEY_FILE -o StrictHostKeyChecking=no"

# Step 1: Install dependencies on EC2
echo ""
echo "📦 Step 1: Installing system dependencies..."
$SSH_CMD << 'REMOTE_SCRIPT'
set -e

# Update system
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# Install essential packages
sudo apt-get install -y \
    git curl wget unzip build-essential \
    software-properties-common nginx certbot \
    python3-certbot-nginx redis-server htop ufw

# Install Node.js 20 LTS
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install Python 3.11+ with venv
sudo apt-get install -y python3 python3-venv python3-pip python3-dev

# Install PM2
sudo npm install -g pm2

# Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow 8000/tcp
sudo ufw --force enable

# Start services
sudo systemctl start nginx redis-server
sudo systemctl enable nginx redis-server

# Create app directory
sudo mkdir -p /var/www/quanttrade
sudo chown -R ubuntu:ubuntu /var/www/quanttrade
sudo mkdir -p /var/log/quanttrade
sudo chown -R ubuntu:ubuntu /var/log/quanttrade

echo "✅ System setup complete!"
echo "Node.js: $(node --version)"
echo "Python: $(python3 --version)"
REMOTE_SCRIPT

# Step 2: Copy project files
echo ""
echo "📁 Step 2: Copying project files to EC2..."

# Create a clean archive of the project (excluding node_modules, venv, etc.)
cd $LOCAL_PROJECT
tar --exclude='node_modules' \
    --exclude='venv' \
    --exclude='.venv' \
    --exclude='__pycache__' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='*.pyc' \
    --exclude='.DS_Store' \
    -czf /tmp/quanttrade.tar.gz .

# Copy to EC2
$SCP_CMD /tmp/quanttrade.tar.gz $EC2_HOST:/tmp/

# Extract on EC2
$SSH_CMD << 'EXTRACT_SCRIPT'
cd /var/www/quanttrade
rm -rf * 2>/dev/null || true
tar -xzf /tmp/quanttrade.tar.gz
rm /tmp/quanttrade.tar.gz
echo "✅ Files extracted!"
ls -la
EXTRACT_SCRIPT

rm /tmp/quanttrade.tar.gz

# Step 3: Setup Backend
echo ""
echo "🐍 Step 3: Setting up backend..."
$SSH_CMD << 'BACKEND_SCRIPT'
cd /var/www/quanttrade/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Upgrade pip and install dependencies
pip install --upgrade pip
pip install -r requirements.txt

echo "✅ Backend setup complete!"
BACKEND_SCRIPT

# Step 4: Setup Frontend
echo ""
echo "⚛️  Step 4: Setting up frontend..."
$SSH_CMD << 'FRONTEND_SCRIPT'
cd /var/www/quanttrade/frontend

# Install dependencies
npm ci

# Build for production
npm run build

echo "✅ Frontend build complete!"
FRONTEND_SCRIPT

# Step 5: Create PM2 ecosystem
echo ""
echo "🔧 Step 5: Configuring PM2..."
$SSH_CMD << 'PM2_SCRIPT'
cd /var/www/quanttrade

cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'quanttrade-backend',
      cwd: '/var/www/quanttrade/backend',
      script: 'venv/bin/python',
      args: '-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2',
      interpreter: 'none',
      env_file: '/var/www/quanttrade/backend/.env',
      max_memory_restart: '500M',
      error_file: '/var/log/quanttrade/backend-error.log',
      out_file: '/var/log/quanttrade/backend-out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'quanttrade-frontend',
      cwd: '/var/www/quanttrade/frontend',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '300M',
      error_file: '/var/log/quanttrade/frontend-error.log',
      out_file: '/var/log/quanttrade/frontend-out.log',
      merge_logs: true,
      time: true,
    }
  ]
};
EOF

echo "✅ PM2 config created!"
PM2_SCRIPT

# Step 6: Configure nginx
echo ""
echo "🌐 Step 6: Configuring nginx..."
$SSH_CMD << 'NGINX_SCRIPT'
sudo tee /etc/nginx/sites-available/quanttrade << 'NGINX_CONF'
# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=30r/s;

upstream backend {
    server 127.0.0.1:8000;
    keepalive 32;
}

upstream frontend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name _;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # API Backend
    location /api/ {
        limit_req zone=api_limit burst=50 nodelay;
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    location /health {
        proxy_pass http://backend/health;
        proxy_set_header Host $host;
    }
    
    location /docs {
        proxy_pass http://backend/docs;
        proxy_set_header Host $host;
    }
    
    location /openapi.json {
        proxy_pass http://backend/openapi.json;
    }

    # Frontend
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /_next/ {
        proxy_pass http://frontend;
        proxy_cache_valid 200 30d;
        add_header Cache-Control "public, immutable, max-age=2592000";
    }

    access_log /var/log/nginx/quanttrade_access.log;
    error_log /var/log/nginx/quanttrade_error.log;
}
NGINX_CONF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/quanttrade /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo "✅ Nginx configured!"
NGINX_SCRIPT

echo ""
echo "============================================"
echo "  ✅ Deployment infrastructure ready!"
echo "============================================"
echo ""
echo "⚠️  IMPORTANT: You need to copy your .env file!"
echo ""
echo "Run this command to copy your backend .env:"
echo "  scp -i ~/Downloads/texas-yash-admin-mbp.pem \\"
echo "      /Users/yash/Downloads/Finance/backend/.env \\"
echo "      ubuntu@ec2-18-117-248-103.us-east-2.compute.amazonaws.com:/var/www/quanttrade/backend/.env"
echo ""
echo "Then start the application:"
echo "  ssh -i ~/Downloads/texas-yash-admin-mbp.pem ubuntu@ec2-18-117-248-103.us-east-2.compute.amazonaws.com"
echo "  cd /var/www/quanttrade && pm2 start ecosystem.config.js && pm2 save && pm2 startup"
echo ""
echo "Your app will be at: http://18.117.248.103"
echo ""
