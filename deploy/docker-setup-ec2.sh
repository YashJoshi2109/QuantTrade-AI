#!/bin/bash
# ============================================
# QuantTrade AI - EC2 Docker Setup Script
# Run this ONCE on a fresh EC2 Ubuntu instance
# ============================================
set -e

echo "🚀 QuantTrade AI - EC2 Docker Setup"
echo "===================================="

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# Install Docker Compose plugin
echo "📦 Installing Docker Compose..."
sudo apt install docker-compose-plugin -y

# Create deployment directory
echo "📁 Creating deployment directory..."
sudo mkdir -p /opt/quanttrade
sudo chown ubuntu:ubuntu /opt/quanttrade

# Create .env template
echo "📝 Creating .env template..."
cat > /opt/quanttrade/.env.template << 'EOF'
# ============================================
# QuantTrade AI - Environment Variables
# Copy this to .env and fill in your values
# ============================================

# Database (Neon Postgres)
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# JWT Authentication
JWT_SECRET_KEY=your-super-secret-jwt-key-change-this
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PLUS_MONTHLY=price_xxx
STRIPE_PRICE_PLUS_YEARLY=price_xxx

# API Keys
OPENAI_API_KEY=sk-xxx
FINNHUB_API_KEY=xxx
NEWSAPI_KEY=xxx

# Frontend
NEXT_PUBLIC_API_URL=https://quanttrade.us

# Redis (optional)
REDIS_URL=
EOF

# Secure permissions
chmod 600 /opt/quanttrade/.env.template

echo ""
echo "✅ Docker setup complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Log out and back in (for Docker group permissions)"
echo "  2. Create your .env file:"
echo "     cp /opt/quanttrade/.env.template /opt/quanttrade/.env"
echo "     nano /opt/quanttrade/.env"
echo "  3. Set up GitHub Secrets in your repository:"
echo "     - EC2_HOST: $(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo "     - EC2_USER: ubuntu"
echo "     - EC2_SSH_KEY: (your private SSH key)"
echo "  4. Push to main branch to trigger deployment!"
echo ""
echo "🔒 Don't forget to secure your .env file:"
echo "     chmod 600 /opt/quanttrade/.env"
