#!/bin/bash
# ============================================================================
# Nginx Configuration Setup Script
# Usage: sudo ./setup-nginx.sh [domain]
# Example: sudo ./setup-nginx.sh quanttrade.example.com
# ============================================================================

set -e

DOMAIN=${1:-"_"}
DEPLOY_DIR="$(dirname "$0")"

echo "============================================"
echo "  QuantTrade AI - Nginx Setup"
echo "============================================"

# Copy nginx configuration
echo "📁 Copying nginx configuration..."
cp "$DEPLOY_DIR/nginx/quanttrade.conf" /etc/nginx/sites-available/quanttrade

# Update domain in config if provided
if [ "$DOMAIN" != "_" ]; then
    echo "🌐 Setting domain to: $DOMAIN"
    sed -i "s/server_name _;/server_name $DOMAIN www.$DOMAIN;/" /etc/nginx/sites-available/quanttrade
fi

# Enable the site
echo "🔗 Enabling site..."
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/quanttrade /etc/nginx/sites-enabled/

# Test nginx configuration
echo "🔍 Testing nginx configuration..."
nginx -t

# Reload nginx
echo "🔄 Reloading nginx..."
systemctl reload nginx

# Setup SSL with Let's Encrypt (if domain is provided)
if [ "$DOMAIN" != "_" ]; then
    echo ""
    read -p "Would you like to setup SSL with Let's Encrypt? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🔐 Setting up SSL certificate..."
        certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect
        
        # Setup auto-renewal
        echo "📅 Setting up auto-renewal..."
        (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    fi
fi

echo ""
echo "============================================"
echo "  ✅ Nginx Setup Complete!"
echo "============================================"
echo ""
if [ "$DOMAIN" != "_" ]; then
    echo "Your site is available at: https://$DOMAIN"
else
    echo "Your site is available at: http://YOUR_EC2_PUBLIC_IP"
fi
echo ""
