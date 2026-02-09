# Quants AI Trading

A comprehensive AI-powered trading and research platform with TradingView-style UI, featuring real-time market data, AI copilot, RAG-powered insights, and backtesting capabilities.

**Live app:** [https://quanttrade.us/](https://quanttrade.us/)

---

## Table of Contents

- [Core Features](#-core-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Screenshots](#images--prototype)
- [Documentation](#-documentation)
- [License](#-license)

---

## Core Features

- **Symbol Analysis with AI** — Real-time charts, indicators, and AI-powered explanations
- **Earnings & Filings Deep Dive** — RAG-powered analysis of SEC filings and earnings calls
- **Personal Watchlist** — Portfolio-aware AI insights and risk monitoring
- **Strategy Backtesting** — Rule-based strategy testing with AI explanations
- **Risk Analysis** — Comprehensive risk scoring and factor analysis

---

## Architecture

```
┌─────────────┐
│   Frontend  │  Next.js with TradingView-style charts
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

**Project structure:**

```
Finance/
├── backend/              # FastAPI backend
│   ├── app/
│   │   ├── api/           # API routes (auth, symbols, prices, chat, backtest, etc.)
│   │   ├── services/      # Business logic (RAG, embeddings, data fetchers)
│   │   ├── models/        # SQLAlchemy models
│   │   ├── db/            # Database setup
│   │   └── tasks/         # Celery background jobs
│   └── scripts/           # Data sync & DB init scripts
├── frontend/              # Next.js (App Router) frontend
│   └── src/
│       ├── app/           # Pages (research, watchlist, backtest, markets, etc.)
│       ├── components/    # UI components, charts, panels
│       ├── contexts/      # Auth context
│       ├── hooks/         # Realtime quote, news hooks
│       └── lib/           # API client, auth, store
└── docs/                  # Additional documentation
```

---

## Tech Stack

| Layer     | Technologies |
|----------|--------------|
| **Backend**  | Python, FastAPI, SQLAlchemy, PostgreSQL, Celery, Redis |
| **Frontend** | Next.js 16, React 18, TypeScript, Tailwind CSS, TradingView Lightweight Charts, Zustand, TanStack Query |
| **AI/ML**    | OpenAI/Anthropic API, LangChain, Chroma/Pinecone (vector store) |
| **Data**     | yfinance, Finnhub, Finviz, SEC EDGAR API |
| **DevOps**   | Docker, GitHub Actions, Neon (PostgreSQL) |

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL (or use [Neon](https://neon.tech) for hosted Postgres)
- Redis (for Celery background jobs)


```bash
# Optional: run enhanced setup (sync symbols, etc.)
./setup_enhanced.sh

# Start API server
uvicorn app.main:app --reload
```

### Quick local stack (backend only)

From project root you can use Docker:

```bash
docker-compose up
```

See `docs/QUICK_START.md` and `docs/INSTALLATION_EXPLAINED.md` for detailed setup and env vars.

---

## Images / Prototype

**Home Page**

<img width="3024" height="1742" alt="image" src="https://github.com/user-attachments/assets/dab22b31-d1dd-48bf-bf64-8dfca00a5e58" />

**Research Page**

<img width="1512" height="949" alt="image" src="https://github.com/user-attachments/assets/036e1389-bd50-4ee8-80d3-33b497b0d8a9" />
<img width="1512" height="879" alt="image" src="https://github.com/user-attachments/assets/0c405a57-96b4-4a26-8d8e-199dd6836572" />

**Real time Market Page**

<img width="1512" height="864" alt="image" src="https://github.com/user-attachments/assets/335aeb93-ca59-4213-abd9-30274f988b5a" />

**Real time News (as per stock)**

<img width="1512" height="870" alt="image" src="https://github.com/user-attachments/assets/8f218e1c-bd0f-422f-98c9-b0a6b2decb31" />

**Ideas-lab**

<img width="1512" height="866" alt="image" src="https://github.com/user-attachments/assets/f7f957a8-2edd-42e5-9ac5-660e29b7d049" />

**Backtest**

<img width="1512" height="866" alt="image" src="https://github.com/user-attachments/assets/d671b99a-5e2a-4101-aac4-96f2d4147dea" />

**System Settings & Preference**

<img width="1512" height="870" alt="image" src="https://github.com/user-attachments/assets/62756c6c-6f66-4581-92ce-0db7123dc1d7" />

---

## Documentation

- [Quick Start](docs/QUICK_START.md) — Fast setup and key endpoints
- [Architecture](docs/ARCHITECTURE.md) — System design
- [Tech Stack](docs/TECH_STACK.md) — Stack details
- [Neon Setup](docs/NEON_MIGRATION_GUIDE.md) — PostgreSQL with Neon
- [Installation](docs/INSTALLATION_EXPLAINED.md) — Full installation guide

---

## License

MIT
