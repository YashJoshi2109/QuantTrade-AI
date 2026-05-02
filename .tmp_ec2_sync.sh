#!/bin/zsh
set -e
KEY_FILE=~/Downloads/texas-yash-admin-mbp.pem
{
  echo "== ssh check =="
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY_FILE" ubuntu@3.19.207.79 "echo connected"
  echo "== scp env =="
  scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY_FILE" /Users/yash/Downloads/QuantTrade-AI/backend/.env ubuntu@3.19.207.79:/var/www/quanttrade/.env
  echo "== restart =="
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY_FILE" ubuntu@3.19.207.79 "cd /var/www/quanttrade && docker compose -f docker-compose.prod.yml up -d --force-recreate"
  echo "== done =="
} > /Users/yash/Downloads/QuantTrade-AI/.ec2-sync.log 2>&1
