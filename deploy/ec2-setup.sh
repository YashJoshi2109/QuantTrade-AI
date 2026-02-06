#!/bin/bash
# ============================================================================
# EC2 Instance Setup Script for QuantTrade AI
# Run this script on a fresh Ubuntu 22.04/24.04 EC2 instance
# Usage: chmod +x ec2-setup.sh && sudo ./ec2-setup.sh
# ============================================================================

set -e

echo "============================================"
echo "  QuantTrade AI - EC2 Setup Script"
echo "============================================"

# Update system
echo "📦 Updating system packages..."
apt-get update && apt-get upgrade -y

# Install essential packages
echo "📦 Installing essential packages..."
apt-get install -y \
    git \
    curl \
    wget \
    unzip \
    build-essential \
    software-properties-common \
    nginx \
    certbot \
    python3-certbot-nginx \
    redis-server \
    supervisor \
    htop \
    ufw

# Install Node.js 20 LTS
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Python 3.11+
echo "📦 Installing Python 3.11..."
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update
apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip

# Set Python 3.11 as default
update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Install PM2 for Node.js process management
echo "📦 Installing PM2..."
npm install -g pm2

# Configure firewall
echo "🔥 Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 8000/tcp  # Backend API
ufw allow 3000/tcp  # Frontend (dev only)
ufw --force enable

# Start and enable services
echo "🚀 Starting services..."
systemctl start nginx
systemctl enable nginx
systemctl start redis-server
systemctl enable redis-server

# Create application directory
echo "📁 Creating application directory..."
mkdir -p /var/www/quanttrade
chown -R ubuntu:ubuntu /var/www/quanttrade

# Create log directories
mkdir -p /var/log/quanttrade
chown -R ubuntu:ubuntu /var/log/quanttrade

echo ""
echo "============================================"
echo "  ✅ EC2 Base Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Clone your repository to /var/www/quanttrade"
echo "2. Copy your .env files"
echo "3. Run: ./deploy/deploy-app.sh"
echo ""
echo "Installed versions:"
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  Python: $(python3 --version)"
echo "  nginx: $(nginx -v 2>&1)"
echo ""
