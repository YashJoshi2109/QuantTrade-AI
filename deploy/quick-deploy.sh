#!/bin/bash
# ============================================================================
# Quick Deploy Script - One command to update and restart
# Usage: ./quick-deploy.sh
# ============================================================================

set -e

# ===== VERIFY PORT 6379 IS FREE =====
echo "🟢 Verifying port 6379 is free..."
if sudo ss -lntp | grep ':6379' | grep -v docker; then
  echo "❌ ERROR: Port 6379 still in use by non-Docker process!"
  sudo ss -lntp | grep ':6379'
  fuser -k 6379/tcp
fi
docker ps -q --filter "publish=6379" | xargs -r docker stop || true

APP_DIR="/var/www/quanttrade"

echo "🚀 Quick Deploy - QuantTrade AI"
echo "================================"

cd $APP_DIR

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin main

# Update backend
echo "🐍 Updating backend..."
cd backend
source venv/bin/activate
pip install -r requirements.txt --quiet

# Update frontend
echo "⚛️  Updating frontend..."
cd ../frontend
npm ci --silent
npm run build

# Restart services
echo "🔄 Restarting services..."
pm2 restart all

echo ""
echo "✅ Deployment complete!"
pm2 list
