#!/bin/bash
# ============================================================================
# Application Deployment Script for QuantTrade AI
# Run this after ec2-setup.sh and cloning the repository
# Usage: ./deploy-app.sh
# ============================================================================

set -e

APP_DIR="/var/www/quanttrade"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

echo "============================================"
echo "  QuantTrade AI - Application Deployment"
echo "============================================"

cd $APP_DIR

# ============================================================================
# Backend Setup
# ============================================================================
echo ""
echo "🐍 Setting up Backend..."
cd $BACKEND_DIR

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
echo "📦 Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Verify .env exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found in backend/"
    echo "Please copy your .env file to $BACKEND_DIR/.env"
    exit 1
fi

echo "✅ Backend setup complete"

# ============================================================================
# Frontend Setup
# ============================================================================
echo ""
echo "⚛️  Setting up Frontend..."
cd $FRONTEND_DIR

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm ci --production=false

# Build for production
echo "🔨 Building frontend for production..."
npm run build

echo "✅ Frontend setup complete"

# ============================================================================
# Setup PM2 for process management
# ============================================================================
echo ""
echo "🚀 Setting up PM2 process manager..."

cd $APP_DIR

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'quanttrade-backend',
      cwd: '/var/www/quanttrade/backend',
      script: 'venv/bin/uvicorn',
      args: 'app.main:app --host 0.0.0.0 --port 8000 --workers 4',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
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

# Start applications with PM2
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo ""
echo "============================================"
echo "  ✅ Deployment Complete!"
echo "============================================"
echo ""
echo "Services running:"
pm2 list
echo ""
echo "View logs: pm2 logs"
echo "Monitor: pm2 monit"
echo ""
