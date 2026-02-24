#!/bin/bash
# QuantTrade EC2 stability fix: add swap + optional Docker memory limits
# Run on the EC2 instance: bash ec2-fix-stability.sh
set -e

echo "=== 1. Adding 2GB swap (persistent) ==="
if [ -f /swapfile ]; then
  echo "Swap file already exists, skipping creation."
  sudo swapon --show
else
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "Swap enabled."
  sudo swapon --show
fi

echo ""
echo "=== 2. Setting swappiness (prefer RAM, use swap when needed) ==="
if ! grep -q vm.swappiness /etc/sysctl.conf; then
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
  sudo sysctl vm.swappiness=10
fi

echo ""
echo "=== 3. Current memory after swap ==="
free -h

echo ""
echo "Done. Swap will persist across reboots."
