# QuantTrade AI

> **AI-powered global trading & research platform** — real-time markets, copilot intelligence, SEC filings RAG, backtesting, and geopolitical risk monitoring.

**Live:** [https://quanttrade.us](https://quanttrade.us)

---

## What It Does

QuantTrade AI is a full-stack financial intelligence platform that combines real-time market data from 12 global exchanges with AI-driven research tools. Think Bloomberg terminal meets AI copilot — built for traders, analysts, and researchers who want institutional-grade insight without institutional cost.

---

## Features

### Markets & Data
- **Global Markets Dashboard** — Real-time indices, sector heatmaps, and movers across NYSE, NASDAQ, NSE, LSE, TSE, HKEX, SSE, KSC, ASX, SAO, and more
- **Ranked Stock Universe** — 800+ curated stocks across 12 exchanges (US: 300 · India: 100 · UK: 75 · Canada: 50 · Germany: 50 · France: 40 · Japan: 50 · HK: 40 · China: 40 · Korea: 20 · Australia: 20 · Brazil: 15), ranked by market cap + dollar volume + index membership
- **Continent Tabs** — Americas / Europe / Asia / Oceania / Africa view with per-exchange breakdown
- **Stock Snapshot Modal** — Live price, sparkline chart (Yahoo Finance), 52W high/low, P/E, market cap, avg volume (Finnhub basic-financials)
- **Real-time Indices** — World exchange indices with 60s auto-refresh and session % change
- **Gainers & Losers** — Live movers from actual quote cache, no fake data

### Research Copilot
- **AI Chat** — Claude/OpenAI-powered assistant with tool calling: live quotes, news, indicators, SEC filings, watchlist
- **Symbol Deep Dive** — TradingView-style chart, technical indicators, fundamental panel, news feed
- **SEC Filings RAG** — Retrieval-augmented analysis of 10-K, 10-Q, 8-K filings via LangChain + vector store
- **Finnhub Panels** — Insider transactions, analyst recommendations, IPO calendar, company news, basic financials
- **Ideas Lab** — AI-generated trade ideas with catalyst, risk/reward, entry/exit levels

### Strategy & Risk
- **Backtesting Engine** — Rule-based strategy simulation with equity curve, drawdown, Sharpe ratio
- **Risk Analysis** — VaR, beta, correlation heatmap, portfolio risk scoring
- **Watchlist** — Portfolio-aware AI insights, alert conditions, price monitoring

### Global Monitor (Intelligence Layer)
- **12-Layer Intelligence** — Geopolitical events, instability scoring, anomaly detection, geographic clusters, ticker impact correlation
- **3D Globe Visualization** — Interactive Three.js globe with real-time event markers
- **AI Threat Classification** — Severity scoring and market impact prediction
- **Continent News Feed Grid** — Real-time news by region with sentiment

### Auth & Security
- **WebAuthn/Passkey** — Biometric authentication (Face ID / Touch ID / hardware keys) via `py_webauthn`
- **JWT Sessions** — RS256 tokens, refresh rotation, secure httpOnly cookie option
- **Email OTP + Google OAuth** — Multi-method auth flow
- **Subscription Billing** — Stripe integration with plan gating

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Frontend                      │
│  App Router · TypeScript · Tailwind · TanStack Query    │
│  TradingView Charts · Framer Motion · Zustand           │
└────────────────────────┬────────────────────────────────┘
                         │ REST / WebSocket
┌────────────────────────▼────────────────────────────────┐
│                   FastAPI Backend                        │
│  Auth · Markets · Research · Backtest · Monitor         │
│  APScheduler (nightly universe sync) · Rate limiter     │
└──────┬──────────────┬──────────────────┬────────────────┘
       │              │                  │
┌──────▼──────┐ ┌─────▼──────┐  ┌───────▼──────┐
│  PostgreSQL  │ │   Vector   │  │  External    │
│  (Neon)      │ │    Store   │  │  APIs        │
│              │ │ (LangChain)│  │              │
│ • symbols    │ │            │  │ • Finnhub    │
│ • prices     │ │ • SEC RAG  │  │ • FMP        │
│ • watchlist  │ │ • filings  │  │ • Yahoo Fin. │
│ • universe   │ │ • news emb │  │ • Finviz     │
│ • monitor    │ └────────────┘  │ • SEC EDGAR  │
└─────────────┘                  └──────────────┘
```

**Key design principles:**
- No fake data — every number comes from a live API or cached DB row
- Aggressive layered caching: in-memory (TTL) → DB snapshot → live API fallback
- APScheduler nightly jobs: exchange universe sync (00:30 UTC), weekly cleanup (Sun 03:00 UTC)
- All market data paths have graceful degradation; API failures return structured empty states

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| **Charts** | TradingView Lightweight Charts, custom Canvas sparklines |
| **State** | TanStack Query v5, Zustand, React Context |
| **Backend** | Python 3.11, FastAPI, SQLAlchemy 2.0, Pydantic v2 |
| **Database** | PostgreSQL (Neon serverless), APScheduler background jobs |
| **Auth** | py_webauthn (WebAuthn/FIDO2), PyJWT, Google OAuth |
| **AI/LLM** | Anthropic Claude API, OpenAI API, LangChain |
| **Market Data** | Finnhub, FMP, Yahoo Finance, Finviz, SEC EDGAR |
| **Billing** | Stripe (subscriptions, webhooks) |
| **DevOps** | Docker, Nginx, EC2, GitHub Actions |

---

## Project Structure

```
QuantTrade-AI/
├── backend/
│   ├── app/
│   │   ├── api/               # FastAPI routers
│   │   │   ├── auth.py        # JWT + WebAuthn passkey endpoints
│   │   │   ├── market.py      # Indices, movers, sectors, universe
│   │   │   ├── enhanced_endpoints.py  # Finnhub quotes, news, filings
│   │   │   ├── global_monitor.py      # Geopolitical intelligence
│   │   │   └── ...
│   │   ├── models/
│   │   │   ├── exchange_ranked_symbol.py  # Global stock universe
│   │   │   ├── passkey_credential.py      # WebAuthn credentials
│   │   │   ├── symbols_master.py          # Search index
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── exchange_universe_service.py  # FMP screener + priority scoring
│   │   │   ├── finnhub_fetcher.py            # Finnhub API wrapper
│   │   │   ├── rate_limiter.py               # Token bucket + in-memory cache
│   │   │   └── ...
│   │   └── main.py            # App startup, CORS, APScheduler
│   ├── scripts/
│   │   ├── seed_global_universe.py   # Seeds 800+ stocks across 12 exchanges
│   │   ├── seed_symbols_master.py    # Seeds search symbol index
│   │   └── init_database.py
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/
        │   ├── markets/page.tsx    # Global markets with continent tabs
        │   ├── research/page.tsx   # Symbol deep dive
        │   ├── copilot/page.tsx    # AI chat interface
        │   ├── backtest/page.tsx   # Strategy backtester
        │   ├── monitor/page.tsx    # Global intelligence monitor
        │   ├── ideas-lab/page.tsx  # AI trade ideas
        │   └── api/               # Next.js API routes (proxy + cache layer)
        │       ├── exchange/universe/route.ts  # Ranked stock universe
        │       ├── exchange/heatmap/route.ts   # Sector heatmaps
        │       ├── quotes/chart/route.ts       # Yahoo Finance chart proxy
        │       └── finnhub/route.ts            # Finnhub proxy + cache
        ├── components/
        │   ├── StockSnapshotModal.tsx    # Live stock detail modal
        │   ├── MarketHeatmap.tsx         # S&P 500 sector heatmap
        │   ├── MoversHeatmap.tsx         # Movers treemap
        │   └── monitor/                 # Global monitor panels
        └── lib/
            ├── passkey.ts    # WebAuthn registration + authentication
            ├── api.ts        # Backend API client
            └── auth.ts       # JWT token storage
```

---

## Getting Started

### Prerequisites

- Python 3.11+ (3.14 works locally; use 3.11 for Docker/EC2)
- Node.js 18+
- PostgreSQL (or [Neon](https://neon.tech) free tier)

### 1. Clone & setup backend

```bash
git clone https://github.com/yourusername/QuantTrade-AI.git
cd QuantTrade-AI/backend

python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `backend/.env`:

```env
# Database
DATABASE_URL=postgresql://user:password@host/dbname

# AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Market Data
FINNHUB_API_KEY=...          # finnhub.io — free tier (60 calls/min)
FMP_API_KEY=...              # financialmodelingprep.com
FINVIZ_API_KEY=...           # optional

# Auth
SECRET_KEY=your-secret-key-min-32-chars
WEBAUTHN_RP_ID=localhost                      # production: quanttrade.us
WEBAUTHN_ORIGIN=http://localhost:3000         # production: https://quanttrade.us

# Billing (optional)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
FINNHUB_API_KEY=...
FMP_API_KEY=...
NEXT_PUBLIC_FINNHUB_KEY=...
```

### 3. Initialize database & seed data

```bash
cd backend

# Create all tables
python scripts/init_database.py

# Seed 800+ global stocks (US 300 · India 100 · UK 75 · etc.)
python scripts/seed_global_universe.py

# Optional: additional US symbol search index
python scripts/seed_symbols_master.py
```

### 4. Start backend

```bash
uvicorn app.main:app --reload --port 8000
```

### 5. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Stock Universe

The platform maintains a ranked universe of stocks across 12 global exchanges, populated by `seed_global_universe.py` and refreshed nightly by APScheduler:

| Exchange | Count | Key Index |
|----------|-------|-----------|
| 🇺🇸 United States | 300 | S&P 500 + NASDAQ 100 |
| 🇮🇳 India | 100 | NIFTY 50 + NIFTY NEXT 50 |
| 🇬🇧 United Kingdom | 75 | FTSE 100 |
| 🇨🇦 Canada | 50 | TSX 60 |
| 🇩🇪 Germany | 50 | DAX 40 + MDAX |
| 🇫🇷 France | 40 | CAC 40 |
| 🇯🇵 Japan | 50 | Nikkei 225 top |
| 🇭🇰 Hong Kong | 40 | Hang Seng |
| 🇨🇳 China | 40 | CSI 300 top |
| 🇰🇷 South Korea | 20 | KOSPI top |
| 🇦🇺 Australia | 20 | ASX 20 |
| 🇧🇷 Brazil | 15 | IBOVESPA top |

**Priority score formula** (used for ranking when FMP screener data is available):
```
score = 0.35 × norm_market_cap
      + 0.35 × norm_dollar_volume
      + 0.15 × index_membership_weight
      + 0.10 × analyst_coverage
      + 0.05 × user_interest
```

---

## API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/market/universe?exchange=us&limit=300` | Ranked stock universe by exchange |
| `GET /api/v1/market/movers` | Real-time gainers + losers |
| `GET /api/v1/market/sectors` | S&P 500 sector performance |
| `GET /api/v1/enhanced/quote/{symbol}/finnhub` | Live Finnhub quote |
| `GET /api/v1/enhanced/financials/{symbol}/finnhub` | Basic financials (52W, P/E, etc.) |
| `GET /api/v1/auth/passkey/register/challenge` | WebAuthn registration challenge |
| `POST /api/v1/auth/passkey/auth/verify` | WebAuthn assertion verify → JWT |
| `GET /api/v1/global-monitor/events` | Geopolitical events feed |
| `GET /health` | Health check |

Full interactive docs: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Deployment (Docker / EC2)

```bash
# Build and start all services
docker-compose up -d

# After first deploy, seed the database
docker-compose exec backend python scripts/seed_global_universe.py
```

**Required production env vars:**
```env
WEBAUTHN_RP_ID=quanttrade.us
WEBAUTHN_ORIGIN=https://quanttrade.us
ALLOWED_ORIGINS=https://quanttrade.us,https://www.quanttrade.us
DATABASE_URL=postgresql://...
```

---

## Screenshots

**Home — Market Intelligence Dashboard**
<img width="3024" height="1742" alt="Dashboard" src="https://github.com/user-attachments/assets/dab22b31-d1dd-48bf-bf64-8dfca00a5e58" />

**Research — Deep Dive with Finnhub Panels**
<img width="1512" height="949" alt="Research" src="https://github.com/user-attachments/assets/036e1389-bd50-4ee8-80d3-33b497b0d8a9" />
<img width="1512" height="879" alt="Financials" src="https://github.com/user-attachments/assets/0c405a57-96b4-4a26-8d8e-199dd6836572" />

**Global Markets — Continent Tabs + Heatmaps**
<img width="1512" height="864" alt="Markets" src="https://github.com/user-attachments/assets/335aeb93-ca59-4213-abd9-30274f988b5a" />

**Real-time News by Symbol**
<img width="1512" height="870" alt="News" src="https://github.com/user-attachments/assets/8f218e1c-bd0f-422f-98c9-b0a6b2decb31" />

**Ideas Lab — AI Trade Ideas**
<img width="1512" height="866" alt="Ideas Lab" src="https://github.com/user-attachments/assets/f7f957a8-2edd-42e5-9ac5-660e29b7d049" />

**Backtesting Engine**
<img width="1512" height="866" alt="Backtest" src="https://github.com/user-attachments/assets/d671b99a-5e2a-4101-aac4-96f2d4147dea" />

---

## Documentation

- [Quick Start](docs/QUICK_START.md) — Fast setup and key endpoints
- [Architecture](docs/ARCHITECTURE.md) — System design deep dive
- [Global Monitor](docs/GLOBAL_MONITOR_README.md) — Geopolitical intelligence layer
- [Neon Setup](docs/NEON_MIGRATION_GUIDE.md) — Serverless PostgreSQL configuration
- [Installation Guide](docs/INSTALLATION_EXPLAINED.md) — Full environment setup

---

## License

MIT — see [LICENSE](LICENSE)
