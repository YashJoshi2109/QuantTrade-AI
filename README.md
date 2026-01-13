# AI Trading & Research Copilot

A comprehensive AI-powered trading and research platform with TradingView-style UI, featuring real-time market data, AI copilot, RAG-powered insights, and backtesting capabilities.

## 🎯 Core Features

- **Symbol Analysis with AI**: Real-time charts, indicators, and AI-powered explanations
- **Earnings & Filings Deep Dive**: RAG-powered analysis of SEC filings and earnings calls
- **Personal Watchlist**: Portfolio-aware AI insights and risk monitoring
- **Strategy Backtesting**: Rule-based strategy testing with AI explanations
- **Risk Analysis**: Comprehensive risk scoring and factor analysis

## 🏗️ Architecture

```
┌─────────────┐
│   Frontend  │  React/Next.js with TradingView-style charts
│  (Web App)  │
└──────┬──────┘
       │
┌──────▼──────────────────┐
│   API Gateway/Backend   │  FastAPI REST API
└──────┬──────────────────┘
       │
   ┌───┴──────────────────────────────┐
   │                                   │
┌──▼──────────┐              ┌─────────▼────────┐
│   Data      │              │   RAG/Copilot    │
│  Services   │              │    Service       │
│             │              │                  │
│ - Market    │              │ - Embeddings     │
│   Data      │              │ - Vector Store   │
│ - News      │              │ - LLM Agent      │
│ - Filings   │              │ - Tool Calling   │
└─────────────┘              └──────────────────┘
       │
┌──────▼──────────────────┐
│   Storage Layer         │
│                        │
│ - PostgreSQL (OHLCV)   │
│ - Vector DB (RAG)      │
│ - Object Storage       │
└────────────────────────┘
```
```
Finance/
├── backend/           # FastAPI backend
│   ├── app/
│   │   ├── api/       # API routes
│   │   ├── services/  # Business logic
│   │   ├── models/    # Data models
│   │   └── db/        # Database setup
│   └── scripts/       # Data ingestion scripts
├── frontend/          # React/Next.js frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── hooks/
│   └── public/
└── docs/              # Documentation
```

## 🛠️ Tech Stack

- **Backend**: Python, FastAPI, SQLAlchemy, PostgreSQL
- **Frontend**: React/Next.js, TypeScript, TradingView Lightweight Charts
- **AI/ML**: OpenAI/Anthropic API, LangChain, Chroma/Pinecone
- **Data**: yfinance, Alpha Vantage, SEC EDGAR API
- **DevOps**: Docker, GitHub Actions

## 📝 License

MIT
