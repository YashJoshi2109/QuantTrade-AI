# AI Trading & Research Copilot - Project Overview

## 🎯 Vision

Build a comprehensive AI-powered trading and research platform that combines:
- **TradingView-style UI** for professional charting
- **AI Copilot** for intelligent market analysis
- **RAG-powered insights** from news and SEC filings
- **Quantitative tools** for risk analysis and backtesting

## 📊 Current Status: Phase 1 Complete ✅

### What's Built

#### Backend (FastAPI)
- ✅ RESTful API with symbol, price, and indicator endpoints
- ✅ PostgreSQL database schema (symbols, price_bars, watchlists)
- ✅ Market data ingestion using yfinance
- ✅ Technical indicators service (SMA, EMA, RSI, MACD, Bollinger Bands)
- ✅ Data sync scripts for initial population
- ✅ CORS configuration for frontend integration

#### Frontend (Next.js + React)
- ✅ TradingView-style dark theme UI
- ✅ Symbol search with autocomplete
- ✅ Candlestick charts using Lightweight Charts
- ✅ Real-time indicator display panel
- ✅ Responsive layout with sidebar navigation

#### Infrastructure
- ✅ Docker Compose for PostgreSQL
- ✅ Environment configuration
- ✅ Project structure and documentation
- ✅ Development setup guides

### API Endpoints Available

```
GET  /api/v1/symbols              # List/search symbols
GET  /api/v1/symbols/{symbol}      # Get symbol details
POST /api/v1/symbols/{symbol}/sync # Sync symbol data
GET  /api/v1/prices/{symbol}       # Get price bars
POST /api/v1/prices/{symbol}/sync  # Sync price data
GET  /api/v1/indicators/{symbol}   # Get technical indicators
POST /api/v1/chat                  # AI copilot (Phase 2 placeholder)
```

## 🗺️ Roadmap

### Phase 2: News/Filings + RAG (Weeks 3-4)
- News API integration
- SEC EDGAR filings scraper
- Document chunking and embedding
- Vector database (ChromaDB)
- RAG retrieval system
- LLM agent with tool calling
- Chat interface with citations

### Phase 3: Quant Metrics + Risk (Weeks 5-6)
- Advanced technical indicators
- Volatility and beta calculations
- Risk scoring model
- Watchlist management
- Portfolio dashboard
- Risk insights UI

### Phase 4: Strategy Backtesting (Weeks 7-8)
- Rule-based strategy engine
- Backtest simulation engine
- Strategy templates
- Performance metrics (CAGR, Sharpe, max DD)
- Ideas Lab interface
- AI-powered backtest explanations

### Phase 5: Polish & Production (Ongoing)
- UX improvements and error handling
- Loading states and validation
- Monitoring and logging
- Comprehensive documentation
- Deployment configuration
- CI/CD pipeline

## 🏗️ Architecture Highlights

### Tech Stack
- **Backend**: Python, FastAPI, SQLAlchemy, PostgreSQL
- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Charts**: TradingView Lightweight Charts
- **Data**: yfinance (market data)
- **AI/ML**: OpenAI API, LangChain, ChromaDB (Phase 2+)

### Design Principles
- **Modular**: Clear separation of concerns
- **Scalable**: Database indexing, async processing ready
- **Extensible**: Easy to add new indicators, data sources, features
- **Developer-friendly**: Comprehensive docs, type hints, clear structure

## 📁 Project Structure

```
Finance/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── api/         # API routes
│   │   ├── services/    # Business logic
│   │   ├── models/      # Database models
│   │   └── db/          # Database setup
│   └── scripts/         # Data ingestion
├── frontend/            # Next.js frontend
│   ├── src/
│   │   ├── app/         # Next.js app router
│   │   ├── components/  # React components
│   │   └── lib/         # Utilities & API client
├── docs/                # Documentation
├── docker-compose.yml   # PostgreSQL container
└── README.md           # Main documentation
```

## 🚀 Getting Started

See [QUICKSTART.md](./QUICKSTART.md) for detailed setup instructions.

**TL;DR:**
```bash
# Start database
docker-compose up -d postgres

# Backend
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python scripts/sync_data.py
uvicorn app.main:app --reload

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

## 🎨 Key Features (Current & Planned)

### ✅ Phase 1 Features
- Symbol search and discovery
- Real-time candlestick charts
- Technical indicators (SMA, RSI, MACD, BB)
- Clean, TradingView-inspired UI

### 🔜 Phase 2 Features
- AI-powered market analysis
- News and filings insights
- RAG-based Q&A system
- Document citations

### 🔜 Phase 3 Features
- Portfolio watchlist
- Risk scoring and analysis
- Portfolio dashboard
- Sector/industry breakdowns

### 🔜 Phase 4 Features
- Strategy backtesting
- Performance analytics
- Strategy templates
- AI-powered strategy insights

## 📚 Documentation

- [README.md](./README.md) - Project overview
- [SETUP.md](./SETUP.md) - Detailed setup guide
- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Architecture details
- [PHASES.md](./docs/PHASES.md) - Development phases

## 🤝 Contributing

This is a portfolio project demonstrating:
- Full-stack development (Python + TypeScript)
- Modern web architecture
- AI/ML integration
- Financial data processing
- Professional UI/UX design

## 📝 License

MIT License - Feel free to use this as a reference or starting point!

---

**Built with ❤️ for traders and researchers**
