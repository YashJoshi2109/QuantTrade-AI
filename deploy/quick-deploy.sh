#!/bin/bash
# ============================================================================
# Quick Deploy Script - One command to update and restart
# Usage: ./quick-deploy.sh
# ============================================================================

set -e

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
