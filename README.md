# AI Trading & Research Copilot

A comprehensive AI-powered trading and research platform with TradingView-style UI, featuring real-time market data, AI copilot, RAG-powered insights, and backtesting capabilities.
```
Live app:- https://sunny-hamster-0012a0.netlify.app/
```

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
## Images / Prototype

Home Page
```
<img width="3024" height="1742" alt="image" src="https://github.com/user-attachments/assets/dab22b31-d1dd-48bf-bf64-8dfca00a5e58" />
```
Research Page
```
<img width="1512" height="949" alt="image" src="https://github.com/user-attachments/assets/036e1389-bd50-4ee8-80d3-33b497b0d8a9" />
<img width="1512" height="879" alt="image" src="https://github.com/user-attachments/assets/0c405a57-96b4-4a26-8d8e-199dd6836572" />
```
Real time Market Page
```
<img width="1512" height="864" alt="image" src="https://github.com/user-attachments/assets/335aeb93-ca59-4213-abd9-30274f988b5a" />
```
Real time News ( as per stock)
```
<img width="1512" height="870" alt="image" src="https://github.com/user-attachments/assets/8f218e1c-bd0f-422f-98c9-b0a6b2decb31" />
```
Ideas-lab
```
<img width="1512" height="866" alt="image" src="https://github.com/user-attachments/assets/f7f957a8-2edd-42e5-9ac5-660e29b7d049" />
```
Backtest
```
<img width="1512" height="866" alt="image" src="https://github.com/user-attachments/assets/d671b99a-5e2a-4101-aac4-96f2d4147dea" />
```
System Settings & Preference
```
<img width="1512" height="870" alt="image" src="https://github.com/user-attachments/assets/62756c6c-6f66-4581-92ce-0db7123dc1d7" />
```

## 📝 License

MIT
