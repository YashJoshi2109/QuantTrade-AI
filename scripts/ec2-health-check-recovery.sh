#!/bin/bash
# QuantTrade EC2: If the site doesn't respond locally, restart the Docker stack.
# Install on server and run via cron every 5 min: */5 * * * * /opt/quanttrade/scripts/health-check-recovery.sh
set -e

URL="${1:-http://localhost}"
COMPOSE_DIR="${2:-/opt/quanttrade}"
LOG="$COMPOSE_DIR/var/health-check.log"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

if curl -sf --connect-timeout 5 --max-time 10 "$URL" >/dev/null; then
  exit 0
fi

echo "$(date -u -Iseconds) Site unreachable at $URL, restarting stack in $COMPOSE_DIR" >> "$LOG"
cd "$COMPOSE_DIR"
docker compose -f docker-compose.prod.yml restart >> "$LOG" 2>&1
echo "$(date -u -Iseconds) Restart completed" >> "$LOG"
