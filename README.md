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
- **WebAuthn/Passkey** — Biometric authentication (Face ID / Touch ID / hardware keys) via `webauthn` (PyPI)
- **JWT Sessions** — RS256 tokens, refresh rotation, secure httpOnly cookie option
- **Email OTP + Google OAuth** — Multi-method auth flow
- **Subscription Billing** — Stripe integration with plan gating

---

## Architecture

Complete system design with 8 diagrams: HLD (systems blueprint), LLD (service architecture), ER (database relationships), UML sequences (copilot, ideas lab, auth flows), component diagram (frontend), deployment architecture (AWS + Cloudflare), and background jobs.

### High-Level Design (HLD) — Systems Architecture Blueprint

```mermaid
flowchart TD
    User["End User (Mobile📱 / Desktop💻)"]

    subgraph ReverseProxy ["Edge & Load Balancing"]
        Nginx["Nginx Reverse Proxy\n(SSL, WebAuthn Route, Load Balancing)"]
    end

    subgraph Frontend ["Frontend Ecosystem (React/Next.js & Godot)"]
        UI["Core UI & Animations\n(React, Framer Motion, GSAP)"]
        Godot["Godot Engine\n(godot_ashmarket 3D Export)"]
        Vis["Financial & 3D Visuals\n(Three.js, globe.gl, lightweight-charts, Remotion)"]
        LocalCache["State & Caching\n(TanStack Query, Zustand, LocalStorage)"]
        PlatformAPIs["Hardware APIs\n(WebAuthn Passkeys, Web Audio API)"]
        NextServer["Server Layer\n(App Router, SSR Data Fetching, BFF)"]
    end

    subgraph Backend ["Backend Core (FastAPI)"]
        API["API Gateway\n(Auth, Game, Billing, Chat)"]
        Services["Domain Services\n(WebAuthn, Billing, Storage, OTP)"]
        RT["Real-time Broadcaster\n(WebSocket Manager / SSE)"]
        Jobs["Task Schedulers\n(APScheduler & Celery Pipelines)"]
    end

    subgraph ML ["Machine Learning & AI Engine"]
        LangChain["LangChain Orchestrator\n(RAG Pipes, Memory)"]
        MLModels["Predictive Models\n(XGBoost, LightGBM, scikitlearn, shap)"]
        TA["Feature Engineering\n(ta Technical Analysis, Pandas)"]
    end

    subgraph Storage ["Persistent Storage"]
        DB[("Primary DB (Neon PostgreSQL)\nUsers, Passkeys, Game State\npgvector (Embeddings Index)")]
    end

    subgraph CacheLayer ["Caching & Queue"]
        Cache[("Redis / Upstash\nOTP TTL, Rate Limits, Quote Snapshots, Task Queue")]
    end

    subgraph External ["Cloud & AI External Services"]
        S3["AWS S3 / MinIO (Object Storage)"]
        LLMs["LLM Providers (OpenAI, Anthropic Claude)"]
        MediaAI["Media AI APIs (Fal.ai, ElevenLabs TTS)"]
        MarketData["Market Data & Scrapers (Finviz lxml, Finnhub, FMP)"]
        AuthBilling["Identity & Payments (Stripe Webhooks, Google OAuth)"]
    end

    %% Interactions
    User <-->|biometrics & audio| PlatformAPIs
    PlatformAPIs <-->|inject state| UI
    LocalCache <-->|cache sync| UI
    Godot -->|export models/textures| Vis
    UI <-->|render canvas| Vis
    
    UI -->|navigation / SSR| NextServer
    NextServer -->|REST request| Nginx

    UI <-->|REST + JWT| Nginx
    UI <-->|Live WebSockets| Nginx
    
    Nginx <-->|Forward Traffic| API
    Nginx <-->|Forward WSS| RT

    API -->|business logic| Services
    API -->|push stream| RT

    Services <-->|ACID read/write| DB
    Services <-->|Rate limit / throttle| Cache

    Services <-->|AI context| LangChain
    LangChain <-->|semantic search| DB
    LangChain -->|inference| LLMs
    Services -->|scoring| MLModels
    MLModels <-->|compute features| TA

    Services <-->|Upload/Download| S3
    Services -->|GenAI Assets| MediaAI
    Services <-->|Verify Hooks & OAuth| AuthBilling

    Services -->|Enqueue async| Jobs
    Jobs <-->|Batch writes| DB
    Jobs -->|Web parsing / polling| MarketData
    
    classDef frontend fill:#1e40af,stroke:#60a5fa,color:#fff
    classDef backend fill:#065f46,stroke:#34d399,color:#fff
    classDef storage fill:#854d0e,stroke:#facc15,color:#fff
    classDef cache fill:#5b21b6,stroke:#a78bfa,color:#fff
    classDef external fill:#374151,stroke:#9ca3af,color:#fff
    classDef proxy fill:#0f766e,stroke:#5eead4,color:#fff
    classDef ml fill:#86198f,stroke:#f0abfc,color:#fff
    
    class UI,Vis,LocalCache,PlatformAPIs,NextServer,Godot frontend
    class API,Services,RT,Jobs backend
    class DB storage
    class Cache cache
    class S3,LLMs,MediaAI,MarketData,AuthBilling external
    class Nginx proxy
    class LangChain,MLModels,TA ml
```

### Low-Level Design (LLD) — Service Architecture

```mermaid
flowchart LR
    subgraph API ["API Layer (FastAPI Routers)"]
        direction TB
        AuthAPI["auth.py"]
        CopilotAPI["copilot_stream.py"]
        IdeasAPI["ideas.py"]
        MarketAPI["market.py"]
        MonitorAPI["global_monitor.py"]
        GameAPI["game.py"]
        BillingAPI["billing.py"]
        WSAPI["ws.py"]
        BacktestAPI["backtest.py"]
        ModelIndexAPI["model_index.py"]
    end

    subgraph Services ["Service Layer"]
        direction TB
        subgraph DataFetch ["Data Fetchers"]
            FMP["fmp_client"]
            Finnhub["finnhub_fetcher"]
            Finviz["finviz_fetcher"]
            YF["yfinance"]
            SEC["filings_fetcher"]
            GDELTf["global_monitor_fetchers"]
        end
        subgraph AI ["AI / ML Services"]
            LSTM["lstm_prediction_service"]
            RAG["rag_service"]
            Embed["embedding_service"]
            LLM["llm_router"]
            TA["technical_analysis_service"]
            Conf["confidence_engine"]
            CompA["comprehensive_analysis"]
        end
        subgraph Infra ["Infrastructure"]
            Redis["redis_cache_service"]
            WS["ws_manager"]
            Sched["idea_scheduler"]
            Ingest["data_ingestion_service"]
            Email["email_service"]
            Rate["rate_limiter"]
        end
        subgraph Business ["Business Logic"]
            Bill["billing_service"]
            GameSvc["game_service"]
            BT["backtest_engine"]
            MI["model_index/orchestrator"]
            WLAlert["watchlist_alert_service"]
        end
    end

    CopilotAPI --> RAG & LSTM & CompA & LLM & Conf
    IdeasAPI --> TA & FMP & Finnhub & YF
    MarketAPI --> FMP & Finnhub & YF
    MonitorAPI --> GDELTf
    GameAPI --> GameSvc
    BillingAPI --> Bill
    BacktestAPI --> BT
    ModelIndexAPI --> MI
    WSAPI --> WS

    RAG --> Embed
    LSTM --> YF
    CompA --> FMP & TA & LSTM
    Sched --> TA & Ingest & WS
    MI --> FMP & TA

    classDef api fill:#1e40af,stroke:#60a5fa,color:#fff
    classDef svc fill:#065f46,stroke:#34d399,color:#fff
    classDef ai fill:#86198f,stroke:#f0abfc,color:#fff
    classDef infra fill:#5b21b6,stroke:#a78bfa,color:#fff
    classDef biz fill:#854d0e,stroke:#facc15,color:#fff

    class AuthAPI,CopilotAPI,IdeasAPI,MarketAPI,MonitorAPI,GameAPI,BillingAPI,WSAPI,BacktestAPI,ModelIndexAPI api
    class FMP,Finnhub,Finviz,YF,SEC,GDELTf svc
    class LSTM,RAG,Embed,LLM,TA,Conf,CompA ai
    class Redis,WS,Sched,Ingest,Email,Rate infra
    class Bill,GameSvc,BT,MI,WLAlert biz
```

### Entity Relationship (ER) Diagram

```mermaid
erDiagram
    users ||--o{ watchlists : has
    users ||--o{ portfolios : owns
    users ||--o{ conversations : creates
    users ||--o| billing_customers : "1:1"
    users ||--o| subscriptions : "1:1"
    users ||--o| connected_accounts : "1:1"
    users ||--o| game_characters : "1:1"
    users ||--o{ chat_history : sends
    users ||--o| passkey_credentials : registers

    symbols ||--o{ price_bars : has
    symbols ||--o{ news_articles : about
    symbols ||--o{ filings : filed_by
    symbols ||--o{ watchlists : tracked_in

    portfolios ||--o{ positions : contains
    portfolios ||--o{ transactions : records
    portfolios ||--o{ portfolio_snapshots : snapshots

    positions }o--|| symbols : references

    filings ||--o{ filing_chunks : chunked_into

    conversations ||--o{ chat_history : contains

    game_characters ||--o| game_wallets : "1:1"
    game_characters ||--o{ game_missions : assigned
    game_characters ||--o{ game_portfolio_holdings : holds
    game_characters ||--o{ game_event_logs : logs
    game_characters }o--o{ game_community_groups : "joins via game_character_communities"

    model_index_snapshots ||--o{ basket_holdings : contains

    users {
        int id PK
        string email UK
        string username
        string hashed_password
        string google_id
        bool is_active
        datetime created_at
    }

    symbols {
        int id PK
        string symbol UK
        string name
        string exchange
        string sector
        string industry
        float market_cap
    }

    watchlists {
        int id PK
        int user_id FK
        int symbol_id FK
        string source
    }

    portfolios {
        int id PK
        int user_id FK
        string name
        float cash_balance
        bool is_paper_trading
    }

    positions {
        int id PK
        int portfolio_id FK
        int symbol_id FK
        float quantity
        float avg_cost_basis
        float unrealized_pnl
    }

    transactions {
        int id PK
        int portfolio_id FK
        int symbol_id FK
        string transaction_type
        float quantity
        float price
        float realized_pnl
    }

    conversations {
        uuid id PK
        int user_id FK
        string title
        datetime updated_at
    }

    chat_history {
        int id PK
        int user_id FK
        uuid conversation_id FK
        string role
        text content
        string intent_type
        json payload_json
    }

    filings {
        int id PK
        int symbol_id FK
        string filing_type
        string form_type
        datetime filing_date
    }

    filing_chunks {
        int id PK
        int filing_id FK
        int chunk_index
        text content
        string section
        json embedding
    }

    news_articles {
        int id PK
        int symbol_id FK
        string title
        string source
        string url
        float sentiment
    }

    game_characters {
        int id PK
        int user_id FK
        string name
        string life_stage
        int level
        int xp
        json behavioral_profile
    }

    game_wallets {
        int id PK
        int character_id FK
        float cash_balance
        float net_worth
        float total_invested
    }

    game_missions {
        int id PK
        int character_id FK
        string title
        string status
        int xp_reward
        int gold_reward
    }

    model_index_snapshots {
        int id PK
        string index_id
        string strategy_type
        string regime
        json snapshot_data
    }

    basket_holdings {
        int id PK
        int snapshot_id FK
        string ticker
        float weight
        float composite_score
        json factor_scores
    }

    global_events {
        int id PK
        string event_id UK
        string source
        string category
        string threat_level
        float latitude
        float longitude
        float market_impact_score
    }

    billing_customers {
        int user_id PK
        string stripe_customer_id
    }

    subscriptions {
        int user_id PK
        string stripe_subscription_id
        string status
    }
```

### UML Sequence — Copilot Query Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend (Next.js)
    participant BE as copilot_stream.py
    participant SYM as Symbol Resolver
    participant CA as comprehensive_analysis
    participant LSTM as lstm_prediction_service
    participant RAG as rag_service
    participant CE as confidence_engine
    participant LLM as llm_router (GROQ/OpenRouter)

    User->>FE: Type stock question
    FE->>BE: POST /api/v1/copilot/stream (SSE)

    BE->>SYM: Resolve symbol from query
    SYM-->>BE: symbol = "AAPL"

    par Parallel data assembly
        BE->>CA: build_comprehensive_analysis("AAPL")
        CA->>LSTM: predict("AAPL", [1,7,30])
        LSTM-->>CA: predictions + confidence
        CA-->>BE: structured_data (quote, indicators, regime, risk, prediction)

        BE->>RAG: query(message, symbol, top_k=10)
        RAG-->>BE: filing_chunks + news context
    end

    BE->>CE: compute_confidence(structured_data)
    CE-->>BE: {overall: 78, grade: "B", components: {...}}

    BE-->>FE: SSE event: "intent" (symbol, type)
    BE-->>FE: SSE event: "structured_data" (full analysis JSON)

    BE->>LLM: stream(system_prompt + context + user_query)
    loop Token streaming
        LLM-->>BE: token chunk
        BE-->>FE: SSE event: "token" (chunk)
    end

    BE-->>FE: SSE event: "meta" (model, sources, request_id)
    BE-->>FE: SSE event: "done"
    FE->>User: Rendered analysis + chat response
```

### UML Sequence — Ideas Lab Real-Time Flow

```mermaid
sequenceDiagram
    participant Sched as APScheduler (every 5m)
    participant MDS as market_data_service
    participant TAS as technical_analysis_service
    participant Cache as Redis Cache
    participant WS as WebSocket Manager
    participant FE as Frontend

    Sched->>MDS: get_quotes_batch(64 symbols)
    MDS-->>Sched: {AAPL: Quote, MSFT: Quote, ...}

    loop For each symbol
        Sched->>TAS: compute_signals(symbol)
        TAS-->>Sched: RSI, MACD, BB, trend, confidence
    end

    Sched->>Sched: Score & rank ideas (confidence 0-100)
    Sched->>Cache: SET qt:ideas:trending (TTL 300s)
    Sched->>Cache: PUBLISH qt:ws:ideas

    Cache-->>WS: pub/sub message
    WS-->>FE: WebSocket broadcast (ideas_update)
    FE->>FE: Re-render Ideas Lab grid
```

### UML Sequence — Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant BE as auth.py
    participant DB as Neon PostgreSQL
    participant Email as Brevo/Resend
    participant Google as Google OAuth

    alt Email + Password
        User->>FE: Enter email + password
        FE->>BE: POST /auth/login
        BE->>DB: Verify credentials (bcrypt)
        DB-->>BE: User record
        BE-->>FE: JWT (7-day, HS256)
    else Google OAuth
        User->>FE: Click "Sign in with Google"
        FE->>Google: OAuth redirect
        Google-->>FE: id_token
        FE->>BE: POST /auth/google
        BE->>DB: Find/create user by google_id
        BE-->>FE: JWT
    else WebAuthn Passkey
        User->>FE: Click "Sign in with Passkey"
        FE->>BE: GET /auth/passkey/auth/challenge
        BE-->>FE: challenge + allowCredentials
        FE->>User: Biometric prompt (Face ID / Touch ID)
        User-->>FE: Signed assertion
        FE->>BE: POST /auth/passkey/auth/verify
        BE->>DB: Verify credential signature
        BE-->>FE: JWT
    else Email OTP
        User->>FE: Request OTP
        FE->>BE: POST /auth/otp/send
        BE->>Email: Send 6-digit OTP
        Email-->>User: OTP email
        User->>FE: Enter OTP
        FE->>BE: POST /auth/otp/verify
        BE-->>FE: JWT
    end
```

### Component Diagram — Frontend Pages

```mermaid
flowchart TB
    subgraph Public ["Public Pages"]
        Home["/"]
        About["/about"]
        Pricing["/pricing"]
        Legal["/legal"]
    end

    subgraph Auth ["Auth"]
        Login["/auth"]
        ForgotPW["/auth/forgot-password"]
    end

    subgraph Core ["Core Trading (Auth Required)"]
        Markets["/markets"]
        Watchlist["/watchlist"]
        Research["/research"]
        Copilot["/copilot"]
        IdeasLab["/ideas-lab"]
        Backtest["/backtest"]
        Monitor["/monitor"]
    end

    subgraph Game ["Game Module"]
        GameHub["/game"]
        Dashboard["/game/dashboard"]
        Character["/game/character"]
        Student["/game/student"]
        World["/game/world"]
        Community["/game/community"]
    end

    subgraph Settings ["User Settings"]
        Profile["/settings/profile"]
        Notifications["/settings/notifications"]
        BillSuccess["/billing/success"]
    end

    subgraph APIRoutes ["Next.js API Routes (BFF)"]
        QuoteAPI["/api/quotes/*"]
        ExchangeAPI["/api/exchange/*"]
        AIAnalysis["/api/ai-analysis"]
        CopilotProxy["/api/copilot/stream"]
        FinnhubProxy["/api/finnhub"]
    end

    Home --> Login
    Login --> Markets
    Markets --> Research
    Research --> Copilot
    Copilot -.->|SSE stream| CopilotProxy
    Markets -.->|data| QuoteAPI & ExchangeAPI
    IdeasLab -.->|WebSocket| WSAPI["Backend /ws/ideas"]

    classDef pub fill:#374151,stroke:#9ca3af,color:#fff
    classDef auth fill:#7c2d12,stroke:#fb923c,color:#fff
    classDef core fill:#1e40af,stroke:#60a5fa,color:#fff
    classDef game fill:#86198f,stroke:#f0abfc,color:#fff
    classDef set fill:#065f46,stroke:#34d399,color:#fff
    classDef api fill:#854d0e,stroke:#facc15,color:#fff

    class Home,About,Pricing,Legal pub
    class Login,ForgotPW auth
    class Markets,Watchlist,Research,Copilot,IdeasLab,Backtest,Monitor core
    class GameHub,Dashboard,Character,Student,World,Community game
    class Profile,Notifications,BillSuccess set
    class QuoteAPI,ExchangeAPI,AIAnalysis,CopilotProxy,FinnhubProxy api
```

### Deployment Architecture (AWS + Cloudflare)

```mermaid
flowchart TB
    User["End User"] --> CF["Cloudflare\n(DNS, CDN, DDoS, Turnstile)"]
    CF --> EC2["AWS EC2 Instance"]

    subgraph EC2 ["EC2 (us-east-2)"]
        Nginx["Nginx\n(SSL, HSTS, microcache)"]
        Nginx --> FE["Frontend Container\n(Next.js :3000)"]
        Nginx --> BE["Backend Container\n(FastAPI :8000)"]
    end

    BE --> Neon["Neon PostgreSQL\n(pgvector, serverless)"]
    BE --> ElastiCache["AWS ElastiCache\n(Redis 7)"]
    BE --> SecretsManager["AWS Secrets Manager"]
    BE --> GHCR["GitHub Container Registry\n(Docker images)"]

    subgraph CICD ["GitHub Actions CI/CD"]
        Push["Push to main"] --> Build["Build Docker images"]
        Build --> GHCR
        Build --> Deploy["SSH deploy to EC2"]
    end

    subgraph ExternalAPIs ["External APIs"]
        FMPx["FMP"]
        Finnhubx["Finnhub"]
        YFx["Yahoo Finance"]
        Stripex["Stripe"]
        Brevox["Brevo"]
        GROQx["GROQ"]
        OpenRouterx["OpenRouter"]
        ElevenLabsx["ElevenLabs"]
    end

    BE --> ExternalAPIs

    classDef cloud fill:#1e40af,stroke:#60a5fa,color:#fff
    classDef aws fill:#854d0e,stroke:#facc15,color:#fff
    classDef ext fill:#374151,stroke:#9ca3af,color:#fff

    class CF,GHCR cloud
    class EC2,Neon,ElastiCache,SecretsManager aws
    class FMPx,Finnhubx,YFx,Stripex,Brevox,GROQx,OpenRouterx,ElevenLabsx ext
```

### Background Jobs Architecture

```mermaid
flowchart LR
    subgraph APScheduler ["APScheduler (BackgroundScheduler)"]
        J1["rescore_ideas\n(every 5m)"]
        J2["update_market_pulse\n(every 2m)"]
        J3["news_sentiment_check\n(every 10m)"]
        J4["market_open_scan\n(9:30 AM ET)"]
        J5["ingest_rag_data\n(every 6h)"]
        J6["nightly_sync\n(00:30 UTC)"]
        J7["weekly_cleanup\n(Sun 03:00)"]
        J8["pro_watchlist_alerts\n(every 20m)"]
    end

    J1 --> MDS["market_data_service"] & TAS["technical_analysis"] & Redis["Redis Cache"] & WSM["WebSocket"]
    J2 --> MDS & Redis & WSM
    J3 --> Finn["finnhub_fetcher"] & Redis
    J4 --> MDS & TAS & Redis
    J5 --> Ingest["data_ingestion_service"] & Embed["embedding_service"] & VS["vector_store"]
    J6 --> ExchSvc["exchange_universe_service"] & DB["Neon DB"]
    J7 --> DB
    J8 --> Email["email_service"]

    classDef job fill:#86198f,stroke:#f0abfc,color:#fff
    classDef svc fill:#065f46,stroke:#34d399,color:#fff

    class J1,J2,J3,J4,J5,J6,J7,J8 job
    class MDS,TAS,Redis,WSM,Finn,Ingest,Embed,VS,ExchSvc,DB,Email svc
```

### 🖼 Advanced Visualizations (PlantUML & Excalidraw)
We supply the source code for producing ultra-high fidelity network mapping in `doc/system_design.puml` and `doc/system_design.md`.

* **To render PlantUML locally**: Requires [Graphviz](https://graphviz.org/download/) to be installed on your target machine. Open `.puml` in any compatible IDE or use the CLI: `java -jar plantuml.jar doc/system_design.puml`.
* **To map perfectly in Excalidraw**: Open [Excalidraw](https://excalidraw.com/), click the "Insert" toolbar dropdown -> "Mermaid to Excalidraw". Copy and paste the Mermaid block above to generate a 100% mathematically aligned, beautiful, and directly editable DAG node layout.

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
| **Auth** | webauthn (WebAuthn/FIDO2), PyJWT, Google OAuth |
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
