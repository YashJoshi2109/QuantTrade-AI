# 🚀 Quick Start Guide - Enhanced QuantTrade AI

## ⚡ 60-Second Setup

```bash
cd /Users/yash/Downloads/Finance/backend
source .venv/bin/activate
./setup_enhanced.sh
uvicorn app.main:app --reload
```

## 🎯 Key Features

| Feature | Speed | Coverage |
|---------|-------|----------|
| Real-time quotes | 100-300ms | Any US stock |
| Fundamentals | 100-300ms | 60+ metrics |
| Portfolio tracking | Real-time | Multi-portfolio |
| S&P 500 data | Automated | 500 stocks |
| NASDAQ data | Automated | 100 stocks |

## 📋 Essential Endpoints

### Get Data (Fast!)
```bash
# Real-time quote
curl localhost:8000/api/v1/enhanced/quote/AAPL

# Complete fundamentals
curl localhost:8000/api/v1/enhanced/fundamentals/TSLA

# Market overview
curl localhost:8000/api/v1/enhanced/market-indices
```

### Bulk Operations
```bash
# Sync S&P 500 (first 10)
curl -X POST "localhost:8000/api/v1/enhanced/sync/sp500?limit=10"

# Sync NASDAQ (first 10)
curl -X POST "localhost:8000/api/v1/enhanced/sync/nasdaq?limit=10"
```

### Portfolio (Requires Auth)
```bash
# Create portfolio
curl -X POST localhost:8000/api/v1/enhanced/portfolio/create \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Growth", "initial_cash": 100000}'

# Buy stock
curl -X POST localhost:8000/api/v1/enhanced/portfolio/1/trade \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbol": "NVDA", "transaction_type": "BUY", "quantity": 10}'

# Check performance
curl localhost:8000/api/v1/enhanced/portfolio/1/summary \
  -H "Authorization: Bearer TOKEN"
```

## 🗄️ Database Schema

### Core Tables (Existing)
- `symbols` - Stock metadata
- `price_bars` - Historical OHLCV
- `users` - User accounts
- `watchlists` - User watchlists

### New Tables (Enhanced)
- `fundamentals` - 60+ Finviz metrics
- `realtime_quotes` - Live quotes (<1s)
- `market_indices` - S&P, NASDAQ, DOW
- `portfolios` - User portfolios
- `positions` - Holdings & P&L
- `transactions` - Trade history
- `portfolio_snapshots` - Daily performance

## 🔍 Data Sources

```
Quotes:     Finviz → Alpha Vantage → yfinance
Fundamentals: Finviz (primary)
Historical: Alpha Vantage → yfinance
Indices:    yfinance
```

## 📊 What You Get Per Stock

**From Finviz (60+ fields):**
- Valuation: PE, PEG, P/S, P/B, Forward PE, Market Cap
- Profitability: Margins (profit, operating, gross), ROE, ROA, ROI
- Financial Health: Debt/Equity, Current Ratio, Quick Ratio
- Performance: Beta, RSI, 52W High/Low, ATR
- Earnings: EPS, Forecasts, Dates
- Ownership: Insider%, Institutional%, Short Float
- Analyst: Target Price, Recommendation

## 🎓 Code Examples

### Python Client
```python
import requests

# Get quote
response = requests.get('http://localhost:8000/api/v1/enhanced/quote/AAPL')
quote = response.json()
print(f"AAPL: ${quote['last_price']} ({quote['latency_ms']}ms)")

# Get fundamentals
response = requests.get('http://localhost:8000/api/v1/enhanced/fundamentals/TSLA')
data = response.json()
print(f"PE Ratio: {data['pe_ratio']}")
print(f"ROE: {data['roe']}%")
```

### JavaScript/TypeScript
```typescript
// Fetch quote
const quote = await fetch('http://localhost:8000/api/v1/enhanced/quote/NVDA')
  .then(r => r.json());
console.log(`NVDA: $${quote.last_price}`);

// Fetch fundamentals
const fundamentals = await fetch('http://localhost:8000/api/v1/enhanced/fundamentals/MSFT')
  .then(r => r.json());
console.log(`Market Cap: ${fundamentals.market_cap}`);
```

## 🚨 Important Notes

1. **Authentication**: Portfolio endpoints require JWT token
2. **Rate Limits**: Finviz may rate-limit aggressive scraping
3. **Caching**: Fundamentals cached for 1 hour
4. **Fallback**: System auto-falls back if primary source fails
5. **Validation**: Trade validation prevents invalid transactions

## 🔗 Quick Links

- **API Docs**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health
- **Full Documentation**: `ENHANCED_FEATURES.md`
- **Summary**: `IMPLEMENTATION_SUMMARY.md`

## 📞 Need Help?

Check logs for errors:
```bash
# Server logs show data source being used
✅ Finviz quote for AAPL: 142ms
⚠️  Finviz failed, trying Alpha Vantage...
✅ Alpha Vantage quote: 456ms
```

Reinitialize database:
```bash
python scripts/init_enhanced_database.py
```

---

**Status**: ✅ Production Ready  
**Performance**: Sub-second data fetching  
**Coverage**: S&P 500 + NASDAQ + Any US stock
