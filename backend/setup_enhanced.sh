#!/bin/bash

# QuantTrade AI - Enhanced Setup Script
# Sets up Finviz integration, portfolios, and real-time quotes

echo "=================================="
echo "  QuantTrade AI - Enhanced Setup"
echo "=================================="
echo ""

# Check if virtual environment is activated
if [[ -z "$VIRTUAL_ENV" ]]; then
    echo "⚠️  Virtual environment not activated!"
    echo "Please run: source .venv/bin/activate"
    exit 1
fi

echo "📦 Installing additional dependencies..."
pip install beautifulsoup4 lxml --quiet

echo ""
echo "🗄️  Initializing enhanced database schema..."
python scripts/init_enhanced_database.py

echo ""
echo "=================================="
echo "  ✅ Setup Complete!"
echo "=================================="
echo ""
echo "📋 Quick Test Commands:"
echo ""
echo "1. Start server:"
echo "   uvicorn app.main:app --reload"
echo ""
echo "2. Test real-time quote:"
echo "   curl http://localhost:8000/api/v1/enhanced/quote/AAPL"
echo ""
echo "3. Get fundamentals:"
echo "   curl http://localhost:8000/api/v1/enhanced/fundamentals/TSLA"
echo ""
echo "4. Sync S&P 500 (first 5 stocks):"
echo "   curl -X POST http://localhost:8000/api/v1/enhanced/sync/sp500?limit=5"
echo ""
echo "5. View API docs:"
echo "   http://localhost:8000/docs"
echo ""
echo "📖 See ENHANCED_FEATURES.md for full documentation"
echo ""
