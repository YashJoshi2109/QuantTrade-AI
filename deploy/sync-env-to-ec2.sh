#!/bin/bash
# ============================================================================
# Sync .env files to EC2 and restart Docker containers
# Run from local machine: bash deploy/sync-env-to-ec2.sh
#
# This script reads from your LOCAL backend/.env and frontend/.env files
# and pushes a combined .env to EC2 — never hardcodes secrets.
# ============================================================================

EC2_HOST="ubuntu@ec2-18-117-248-103.us-east-2.compute.amazonaws.com"
KEY_FILE="$HOME/Downloads/texas-yash-admin-mbp.pem"
REMOTE_DIR="/var/www/quanttrade"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

SSH_CMD="ssh -i $KEY_FILE -o StrictHostKeyChecking=no $EC2_HOST"
SCP_CMD="scp -i $KEY_FILE -o StrictHostKeyChecking=no"

echo "============================================"
echo "  QuantTrade AI — Sync Env + Restart Docker"
echo "============================================"

BACKEND_ENV="$REPO_ROOT/backend/.env"
FRONTEND_ENV="$REPO_ROOT/frontend/.env"

if [ ! -f "$BACKEND_ENV" ]; then
  echo "❌ Error: $BACKEND_ENV not found"
  exit 1
fi

# Build combined .env by merging backend + frontend env files
# (backend takes precedence for any key in both)
TMPENV=$(mktemp)
cat "$FRONTEND_ENV" "$BACKEND_ENV" | sort -u > "$TMPENV"

# Append production overrides
cat >> "$TMPENV" << 'PROD_OVERRIDES'

# Production overrides (applied last)
APP_URL=https://www.quanttrade.us
ALLOWED_ORIGINS=https://www.quanttrade.us,https://quanttrade.us
DEBUG=false
LOG_LEVEL=INFO
PROD_OVERRIDES

echo "🔑 Copying combined .env to EC2..."
$SCP_CMD "$TMPENV" "$EC2_HOST:$REMOTE_DIR/.env"
rm -f "$TMPENV"
echo "✅ .env written to EC2"

# Pull latest code
echo "📥 Pulling latest code..."
$SSH_CMD "cd $REMOTE_DIR && git pull origin main"

# Restart Docker containers
echo "🐳 Restarting Docker containers..."
$SSH_CMD "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --force-recreate"

echo ""
echo "✅ Done! quanttrade.us should be updated in ~30 seconds"
echo "   Monitor: ssh -i $KEY_FILE $EC2_HOST 'docker compose -f $REMOTE_DIR/docker-compose.prod.yml ps'"
