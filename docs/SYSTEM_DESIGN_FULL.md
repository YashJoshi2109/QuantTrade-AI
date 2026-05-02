# QuantTrade AI — Full System Design & Architecture

> Generated 2026-05-02. Covers all features: Markets · Copilot RAG · Portfolio · Screener · Community · Global Monitor · QuantTrade Life · Auth · Billing · Admin.

---

## 1. System Context Diagram (C4 Level 1)

```mermaid
C4Context
    title QuantTrade AI — System Context

    Person(user, "User", "Retail investor / quant trader")
    Person(admin, "Admin", "Platform operator")

    System(qt, "QuantTrade AI", "Full-stack fintech platform: real-time markets, agentic RAG copilot, portfolio, community, global monitor, game")

    System_Ext(cloudflare, "Cloudflare", "CDN · WAF · TLS · DNS · Turnstile CAPTCHA · R2 storage")
    System_Ext(aws, "AWS", "EC2 compute · Bedrock LLM (Claude Sonnet 4.6 / Haiku 4.5 · Titan Embed v2)")
    System_Ext(neon, "Neon", "Serverless PostgreSQL — primary database")
    System_Ext(qdrant, "Qdrant Cloud", "Vector DB — 36,627 SEC filing chunks")
    System_Ext(redis, "Redis", "Cache · session · Celery broker")

    System_Ext(finnhub, "Finnhub", "Real-time quotes · news")
    System_Ext(fmp, "FMP", "Fundamentals · financials · DCF")
    System_Ext(alpaca, "Alpaca", "OHLC bars · backtesting")
    System_Ext(edgar, "SEC EDGAR", "10-K · 10-Q · 8-K filings")
    System_Ext(newsapi, "NewsAPI", "Market headlines")
    System_Ext(av, "Alpha Vantage", "RSI · MACD · SMA")

    System_Ext(stripe, "Stripe", "Payments · subscriptions · webhooks")
    System_Ext(brevo, "Brevo", "Transactional email")
    System_Ext(google, "Google OAuth", "Social login")
    System_Ext(cohere, "Cohere", "Rerank v3-5 — RAG reranking")
    System_Ext(openai, "OpenAI", "GPT-4o fallback · text-embedding-3-small")
    System_Ext(openrouter, "OpenRouter", "LLM last-resort fallback")

    Rel(user, qt, "HTTPS · WebSocket · SSE")
    Rel(admin, qt, "Admin panel HTTPS")
    Rel(qt, cloudflare, "All traffic via")
    Rel(qt, aws, "Bedrock API calls")
    Rel(qt, neon, "SQL via psycopg3")
    Rel(qt, qdrant, "Vector search API")
    Rel(qt, redis, "TCP 6379")
    Rel(qt, finnhub, "REST · WebSocket")
    Rel(qt, fmp, "REST")
    Rel(qt, alpaca, "REST")
    Rel(qt, edgar, "REST + HTML scrape")
    Rel(qt, newsapi, "REST")
    Rel(qt, av, "REST")
    Rel(qt, stripe, "REST · webhooks")
    Rel(qt, brevo, "REST")
    Rel(qt, google, "OAuth 2.0")
    Rel(qt, cohere, "REST")
    Rel(qt, openai, "REST fallback")
    Rel(qt, openrouter, "REST fallback")
```

---

## 2. Container Diagram (C4 Level 2)

```mermaid
C4Container
    title QuantTrade AI — Containers

    Person(user, "User")

    Container_Boundary(edge, "Edge Layer") {
        Container(cf_cdn, "Cloudflare CDN", "Cloudflare", "Static assets, caching, DDoS protection")
        Container(cf_waf, "Cloudflare WAF + TLS", "Cloudflare", "TLS termination, bot protection, Turnstile CAPTCHA")
        Container(nginx, "Nginx", "Docker container", "Reverse proxy, rate limiting, SSL passthrough")
    }

    Container_Boundary(frontend, "Frontend") {
        Container(nextjs, "Next.js 15 App", "React · TypeScript · Framer Motion", "SSR pages: Markets, Copilot, Portfolio, Screener, Community, Monitor, Game, Auth, Billing")
    }

    Container_Boundary(backend, "Backend") {
        Container(fastapi, "FastAPI", "Python · Gunicorn/Uvicorn", "REST API + SSE streaming. Auth, markets, copilot, portfolio, screener, community, monitor, game, admin, billing endpoints")
        Container(celery, "Celery Workers", "Python · Redis broker", "Async tasks: SEC ingestion, email sends, market data refresh, scheduler jobs")
        Container(scheduler, "APScheduler", "Python", "Cron jobs: market data refresh, alert checks, game ticks")
    }

    Container_Boundary(ai, "AI Layer") {
        Container(copilot, "Agentic RAG Copilot", "LangGraph · Python", "6 agents: Research, Comparison, Screener, Portfolio, Earnings, General. RAG pipeline: HyDE→hybrid search→Cohere rerank→parent-child.")
        Container(router, "CopilotRouter", "Claude Haiku 4.5", "Intent classification: 11 intents (stock_analysis, comparison, screener, portfolio_advice, earnings, general_advice, education, market_overview, sector, greeting, off_topic)")
    }

    Container_Boundary(data, "Data Layer") {
        ContainerDb(postgres, "Neon PostgreSQL", "PostgreSQL (serverless)", "Users, portfolios, watchlists, posts, game state, theme prefs, passkeyss, billing, alerts")
        ContainerDb(redis_db, "Redis", "Redis", "Hot cache (~1ms), conversation history, Celery queue, rate limit counters")
        ContainerDb(qdrant_db, "Qdrant Cloud", "Vector DB", "36,627 SEC filing chunks. Collections: sec_filings (HNSW + BM42 sparse, 1536-dim)")
        ContainerDb(r2, "Cloudflare R2", "S3-compatible object store", "User uploads, media, profile images")
    }

    Rel(user, cf_cdn, "HTTPS")
    Rel(cf_cdn, cf_waf, "")
    Rel(cf_waf, nginx, "HTTPS")
    Rel(nginx, nextjs, "HTTP :3000")
    Rel(nginx, fastapi, "HTTP :8000 /api/*")
    Rel(nextjs, fastapi, "REST + SSE /api/*")
    Rel(fastapi, copilot, "invoke graph")
    Rel(fastapi, celery, "enqueue tasks")
    Rel(fastapi, postgres, "SQL")
    Rel(fastapi, redis_db, "GET/SET")
    Rel(copilot, qdrant_db, "vector search")
    Rel(copilot, router, "classify intent")
    Rel(celery, qdrant_db, "batch upsert")
    Rel(celery, postgres, "SQL")
    Rel(fastapi, r2, "presigned URLs")
```

---

## 3. High Level Design — Full Platform

```mermaid
flowchart TD
    subgraph USERS["👥 Users"]
        U1["Retail Investor"]
        U2["Quant Trader"]
        U3["Admin"]
    end

    subgraph EDGE["① EDGE LAYER"]
        CF["☁️ Cloudflare\nCDN · WAF · TLS · DNS\nTurnstile CAPTCHA"]
        NGX["🌐 Nginx\nReverse Proxy · Rate Limit\nSSL Termination"]
    end

    subgraph FRONTEND["② FRONTEND — Next.js 15"]
        direction LR
        PG1["📈 Markets\n(charts · heatmap\n· movers · news)"]
        PG2["🤖 Copilot\n(agentic RAG\nSSE streaming)"]
        PG3["💼 Portfolio\n(P&L · risk\n· allocation)"]
        PG4["🔍 Screener\n(filter stocks\nby criteria)"]
        PG5["👥 Community\n(Quant-Agora\n· posts · DMs)"]
        PG6["🌍 Monitor\n(geopolitical\nintelligence)"]
        PG7["🎮 Game\n(QuantTrade Life\nmedieval)"]
        PG8["⚙️ Settings\n(auth · billing\n· theme)"]
    end

    subgraph API["③ BACKEND — FastAPI"]
        direction TB
        AUTH["🔐 Auth Module\nJWT · WebAuthn\nGoogle OAuth · OTP"]
        MARKETS["📊 Markets Module\nReal-time quotes\ncharts · technical"]
        COPILOT_API["🤖 Copilot Module\nSSE /copilot/stream\nRAG ingest endpoint"]
        PORTFOLIO_API["💼 Portfolio Module\nCRUD positions\nP&L calculation"]
        COMMUNITY_API["👥 Community Module\nPosts · likes · DMs\nfollows · search"]
        MONITOR_API["🌍 Monitor Module\n12-layer intelligence\nalerts · events"]
        GAME_API["🎮 Game Module\nLife stages · items\nquests · leaderboard"]
        BILLING_API["💳 Billing Module\nStripe · plans\nwebhooks"]
        ADMIN_API["⚙️ Admin Module\nuser mgmt · metrics\nfeature flags"]
    end

    subgraph AGENTIC["④ AGENTIC RAG LAYER"]
        direction LR
        LG["LangGraph\nSupervisor"]
        AG1["📊 Research\nAgent"]
        AG2["⚖️ Comparison\nAgent"]
        AG3["🔍 Screener\nAgent"]
        AG4["💼 Portfolio\nAgent"]
        AG5["📈 Earnings\nAgent"]
        AG6["🌐 General\nAgent"]
        RAG["RAG Pipeline\nHyDE→Hybrid→Rerank\n→Parent-Child"]
    end

    subgraph DATA_TOOLS["⑤ LIVE DATA TOOLS"]
        direction LR
        D1["📡 Finnhub\nquotes · news"]
        D2["💹 FMP\nfundamentals"]
        D3["📊 Alpaca\nOHLC bars"]
        D4["🏛️ EDGAR\nSEC filings"]
        D5["📰 NewsAPI\nheadlines"]
        D6["📈 Alpha Vantage\ntechnicals"]
    end

    subgraph LLM_LAYER["⑥ LLM + EMBEDDINGS"]
        direction LR
        LLM1["🤖 Claude Sonnet 4.6\n(Bedrock primary)"]
        LLM2["⚡ Claude Haiku 4.5\n(Bedrock routing)"]
        LLM3["🟢 GPT-4o\n(OpenAI fallback)"]
        LLM4["🔀 OpenRouter\n(last resort)"]
        EMB1["🧲 Titan Embed v2\n1536-dim"]
        EMB2["🔵 OAI Embed 3-small\n1536-dim fallback"]
    end

    subgraph STORAGE["⑦ DATA LAYER (Hot → Warm → Cold)"]
        direction LR
        HOT["⚡ Redis\nHOT ~1ms\ncache · sessions\nCelery broker"]
        WARM["🐘 Neon PostgreSQL\nWARM ~10ms\nusers · portfolios\nposts · game"]
        COLD["🔮 Qdrant Cloud\nCOLD RAG\n36K SEC chunks\nvector search"]
        OBJ["☁️ R2\nOBJECT STORE\nuploads · media"]
    end

    subgraph ASYNC["⑧ ASYNC LAYER"]
        CEL["🌿 Celery Workers\nSEC ingestion\nemail tasks"]
        SCHED["⏰ APScheduler\nmarket data refresh\nalerts · game ticks"]
    end

    subgraph EXTERNAL["⑨ EXTERNAL SERVICES"]
        direction LR
        STRIPE["💳 Stripe\nPayments"]
        BREVO["📧 Brevo\nEmail"]
        GOOGLE["🔑 Google OAuth"]
        COHERE["🏆 Cohere\nRerank v3-5"]
    end

    subgraph INFRA["⑩ INFRASTRUCTURE"]
        direction LR
        EC2["🖥️ AWS EC2 t2.small\n1 vCPU · 2 GB RAM"]
        DOCKER["🐳 Docker Compose\nup --wait healthcheck"]
        CI["⚙️ GitHub Actions\nCI/CD auto-deploy"]
        BEDROCK["☁️ AWS Bedrock\nLLM + Embeddings"]
    end

    USERS --> CF
    CF --> NGX
    NGX --> FRONTEND
    NGX --> API
    API --> AUTH & MARKETS & COPILOT_API & PORTFOLIO_API & COMMUNITY_API & MONITOR_API & GAME_API & BILLING_API & ADMIN_API
    COPILOT_API --> LG
    LG --> AG1 & AG2 & AG3 & AG4 & AG5 & AG6
    AG1 & AG2 & AG3 & AG4 & AG5 & AG6 --> RAG
    AG1 & AG2 & AG3 & AG4 & AG5 & AG6 --> DATA_TOOLS
    RAG --> LLM_LAYER
    RAG --> COLD
    API --> HOT
    API --> WARM
    API --> OBJ
    API --> ASYNC
    API --> EXTERNAL
    LLM_LAYER --> BEDROCK
    INFRA --> EC2
```

---

## 4. Request Flow — Copilot Query (Sequence Diagram)

```mermaid
sequenceDiagram
    participant U as 👤 User
    participant CF as ☁️ Cloudflare
    participant NGX as 🌐 Nginx
    participant API as ⚡ FastAPI
    participant REDIS as ⚡ Redis
    participant LG as 🔷 LangGraph
    participant HAIKU as ⚡ Haiku (Router)
    participant AGENTS as 🤖 Agents (parallel)
    participant TOOLS as 📡 Data Tools
    participant QDRANT as 🔮 Qdrant
    participant COHERE as 🏆 Cohere
    participant SONNET as 🤖 Claude Sonnet
    participant UI as 💬 Chat UI

    U->>CF: POST /api/v1/copilot/stream
    CF->>NGX: Forward (TLS stripped)
    NGX->>API: HTTP request
    API->>REDIS: Load conversation history
    REDIS-->>API: Last N turns

    API->>LG: Invoke graph (message + history + routing)
    LG->>HAIKU: Classify intent
    HAIKU-->>LG: Intent = "stock_analysis", ticker = "NVDA"

    LG->>AGENTS: asyncio.gather([research, earnings])
    par Research Agent
        AGENTS->>TOOLS: Finnhub quote, FMP fundamentals
        TOOLS-->>AGENTS: Live price, P/E, revenue
        AGENTS->>QDRANT: HyDE → dense+sparse hybrid search
        QDRANT-->>AGENTS: Top-40 chunks
        AGENTS->>COHERE: rerank-v3-5 top-10
        COHERE-->>AGENTS: Ranked chunks + scores
        AGENTS->>QDRANT: Fetch parent sections
        QDRANT-->>AGENTS: Full parent docs
    and Earnings Agent
        AGENTS->>TOOLS: FMP EPS history, guidance
        TOOLS-->>AGENTS: Earnings data
        AGENTS->>QDRANT: Earnings-focused RAG search
        QDRANT-->>AGENTS: 10-Q earnings chunks
    end

    AGENTS-->>LG: AgentResult (chunks + live_data)
    LG->>LG: merge_node (dedup, sort by score)
    LG->>LG: context_builder (token budget ~3000 tok)
    LG-->>API: final_context + citations

    API->>SONNET: Stream (system + context + query)
    loop SSE token stream
        SONNET-->>API: token chunk
        API-->>U: data: {"token": "..."}
    end

    API-->>U: data: {"citations": [...], "done": true}
    API->>REDIS: Save conversation turn
    U->>UI: Render citations + stock panel
```

---

## 5. Authentication Flow (Sequence Diagram)

```mermaid
sequenceDiagram
    participant U as 👤 User
    participant FE as Next.js
    participant API as FastAPI
    participant DB as PostgreSQL
    participant REDIS as Redis
    participant BREVO as Brevo Email
    participant GOOGLE as Google OAuth

    alt Email + OTP
        U->>FE: Enter email
        FE->>API: POST /auth/request-otp
        API->>DB: Check user exists
        API->>BREVO: Send OTP email (6-digit)
        BREVO-->>U: Email with OTP
        U->>FE: Enter OTP
        FE->>API: POST /auth/verify-otp
        API->>REDIS: Validate OTP (TTL 10min)
        API->>DB: Create/update user
        API-->>FE: JWT access token (30min)
    else Google OAuth
        U->>FE: Click "Sign in with Google"
        FE->>GOOGLE: OAuth2 redirect
        GOOGLE-->>FE: auth code
        FE->>API: POST /auth/google
        API->>GOOGLE: Exchange code → tokens
        GOOGLE-->>API: id_token + profile
        API->>DB: Upsert user (google_id)
        API-->>FE: JWT access token
    else WebAuthn Passkey
        U->>FE: Click passkey login
        FE->>API: POST /auth/passkey/authenticate/begin
        API->>DB: Get user credentials
        API-->>FE: Challenge
        FE->>U: OS biometric prompt
        U-->>FE: Signed assertion
        FE->>API: POST /auth/passkey/authenticate/complete
        API->>DB: Verify credential
        API-->>FE: JWT access token
    end
```

---

## 6. Data Architecture (Hot / Warm / Cold)

```mermaid
flowchart LR
    REQ["📥 Incoming\nRequest"]

    subgraph HOT ["⚡ HOT PATH ~1ms"]
        R1["Redis GET\nsession token"]
        R2["Redis GET\ncached quote"]
        R3["Redis GET\nconv history"]
        R4["Redis RPUSH\nCelery task"]
    end

    subgraph WARM ["🐘 WARM PATH ~10ms"]
        W1["PostgreSQL SELECT\nuser profile"]
        W2["PostgreSQL SELECT\nportfolio positions"]
        W3["PostgreSQL SELECT\ncommunity posts"]
        W4["PostgreSQL UPSERT\ngame state"]
    end

    subgraph COLD ["🔮 COLD PATH ~50-400ms"]
        C1["Qdrant vector search\nRAG chunks"]
        C2["EDGAR HTTP fetch\nSEC filing HTML"]
        C3["Finnhub REST\nreal-time quotes"]
        C4["FMP REST\nfundamentals"]
    end

    subgraph OBJ ["☁️ OBJECT STORE"]
        O1["R2 presigned URL\nuser uploads"]
        O2["R2 presigned URL\nprofile images"]
    end

    REQ --> HOT
    HOT -->|miss| WARM
    WARM -->|not in DB| COLD
    REQ --> OBJ

    subgraph WRITE ["✏️ WRITE PATHS"]
        WR1["Redis SET cache\n(TTL 60s)"]
        WR2["PostgreSQL INSERT\n+ Redis invalidate"]
        WR3["Qdrant upsert\n(via Celery batch)"]
    end
```

---

## 7. Infrastructure & Deployment Diagram

```mermaid
flowchart TD
    subgraph INTERNET["🌍 Internet"]
        USER["👤 Users\n(browser / mobile)"]
    end

    subgraph CF_EDGE["☁️ Cloudflare Edge (Global PoPs)"]
        CF_DNS["DNS\nquanttrade.us → EC2 IP"]
        CF_CDN_STATIC["CDN\n(Next.js static assets\ncached at edge)"]
        CF_WAF["WAF + DDoS\nbot protection"]
        CF_TLS["TLS 1.3\ncertificate"]
        CF_TURN["Turnstile CAPTCHA\nbot gating"]
        CF_R2["R2 Object Store\nuploads · media"]
    end

    subgraph EC2["🖥️ AWS EC2 t2.small (us-east-1)"]
        subgraph DOCKER["🐳 Docker Compose (docker-compose.prod.yml)"]
            SVC_NGINX["nginx:alpine\n:80 :443\nreverse proxy"]
            SVC_BACKEND["python:3.12\n:8000\nFastAPI + Gunicorn\n4 workers"]
            SVC_REDIS["redis:7-alpine\n:6379\ncache + broker"]
        end
        HEALTH["Healthcheck\n/health endpoint\nDocker --wait"]
    end

    subgraph AWS_BEDROCK["☁️ AWS Bedrock (us-east-1)"]
        BED_SONNET["claude-sonnet-4-6"]
        BED_HAIKU["claude-haiku-4-5"]
        BED_TITAN["amazon.titan-embed-text-v2:0"]
    end

    subgraph EXTERNAL_SVC["☁️ External Managed Services"]
        NEON["Neon PostgreSQL\nServerless · auto-scale"]
        QDRANT_C["Qdrant Cloud\nManaged vector DB"]
        COHERE_C["Cohere API\nrerank-v3-5"]
        STRIPE_C["Stripe\nPayments API"]
        BREVO_C["Brevo\nEmail API"]
    end

    subgraph CICD["⚙️ GitHub Actions CI/CD"]
        GH_ML["ML Tests\n(92 unit tests)"]
        GH_CODEQL["CodeQL\nsecurity scan"]
        GH_DEPLOY["Deploy to EC2\nappleboy/ssh-action\ndocker compose up --wait"]
    end

    USER --> CF_DNS
    CF_DNS --> CF_WAF
    CF_WAF --> CF_TLS
    CF_TLS --> SVC_NGINX
    SVC_NGINX --> SVC_BACKEND
    SVC_BACKEND --> SVC_REDIS
    SVC_BACKEND --> AWS_BEDROCK
    SVC_BACKEND --> NEON
    SVC_BACKEND --> QDRANT_C
    SVC_BACKEND --> COHERE_C
    SVC_BACKEND --> STRIPE_C
    SVC_BACKEND --> BREVO_C
    CF_CDN_STATIC -.->|"serve static"| USER
    CICD -->|"git push to main"| GH_ML
    GH_ML -->|"pass"| GH_CODEQL
    GH_CODEQL -->|"pass"| GH_DEPLOY
    GH_DEPLOY -->|"SSH + docker compose"| EC2
```

---

## 8. Database Schema — Entity Relationship Diagram

```mermaid
erDiagram
    USERS {
        uuid id PK
        string email
        string username
        string password_hash
        string google_id
        string theme_pref
        string role
        bool is_active
        bool is_verified
        timestamp created_at
        timestamp updated_at
    }

    PASSKEYS {
        uuid id PK
        uuid user_id FK
        string credential_id
        bytes public_key
        int sign_count
        string device_name
        timestamp created_at
    }

    PORTFOLIOS {
        uuid id PK
        uuid user_id FK
        string name
        string description
        timestamp created_at
    }

    POSITIONS {
        uuid id PK
        uuid portfolio_id FK
        string ticker
        decimal shares
        decimal avg_cost
        string currency
        timestamp opened_at
    }

    WATCHLISTS {
        uuid id PK
        uuid user_id FK
        string name
        jsonb tickers
    }

    POSTS {
        uuid id PK
        uuid user_id FK
        text content
        string post_type
        jsonb media
        int like_count
        int comment_count
        timestamp created_at
    }

    REACTIONS {
        uuid id PK
        uuid post_id FK
        uuid user_id FK
        string reaction_type
    }

    FOLLOWS {
        uuid follower_id FK
        uuid followed_id FK
        timestamp created_at
    }

    GAME_PROFILES {
        uuid id PK
        uuid user_id FK
        int life_stage
        int gold
        int xp
        jsonb inventory
        jsonb active_quests
        timestamp last_tick
    }

    SUBSCRIPTIONS {
        uuid id PK
        uuid user_id FK
        string stripe_customer_id
        string stripe_subscription_id
        string plan
        string status
        timestamp current_period_end
    }

    ALERTS {
        uuid id PK
        uuid user_id FK
        string ticker
        string condition
        decimal target_value
        bool triggered
        timestamp created_at
    }

    USERS ||--o{ PASSKEYS : "has"
    USERS ||--o{ PORTFOLIOS : "owns"
    PORTFOLIOS ||--o{ POSITIONS : "contains"
    USERS ||--o{ WATCHLISTS : "owns"
    USERS ||--o{ POSTS : "creates"
    POSTS ||--o{ REACTIONS : "receives"
    USERS ||--o{ REACTIONS : "makes"
    USERS ||--o{ FOLLOWS : "follows"
    USERS ||--|| GAME_PROFILES : "has"
    USERS ||--o| SUBSCRIPTIONS : "has"
    USERS ||--o{ ALERTS : "sets"
```

---

## 9. API Architecture

```mermaid
flowchart LR
    subgraph AUTH_EP["/auth/*"]
        A1["POST /auth/register"]
        A2["POST /auth/login"]
        A3["POST /auth/request-otp"]
        A4["POST /auth/verify-otp"]
        A5["POST /auth/google"]
        A6["POST /auth/passkey/register/*"]
        A7["POST /auth/passkey/authenticate/*"]
        A8["POST /auth/refresh"]
        A9["POST /auth/logout"]
    end

    subgraph MARKETS_EP["/markets/*"]
        M1["GET /markets/quote/{ticker}"]
        M2["GET /markets/chart/{ticker}"]
        M3["GET /markets/movers"]
        M4["GET /markets/news"]
        M5["GET /markets/heatmap"]
        M6["GET /markets/technical/{ticker}"]
        M7["GET /markets/economic-calendar"]
    end

    subgraph COPILOT_EP["/copilot/*"]
        C1["POST /copilot/stream   SSE"]
        C2["POST /copilot/ingest   admin"]
        C3["GET  /copilot/history"]
        C4["DELETE /copilot/history"]
    end

    subgraph PORTFOLIO_EP["/portfolios/*"]
        P1["CRUD /portfolios"]
        P2["CRUD /portfolios/{id}/positions"]
        P3["GET /portfolios/{id}/performance"]
        P4["GET /portfolios/{id}/risk"]
    end

    subgraph COMMUNITY_EP["/community/*"]
        CM1["CRUD /posts"]
        CM2["POST /posts/{id}/react"]
        CM3["CRUD /comments"]
        CM4["GET /feed"]
        CM5["POST /follow/{user_id}"]
        CM6["GET /search/users"]
    end

    subgraph MONITOR_EP["/monitor/*"]
        MN1["GET /monitor/events"]
        MN2["GET /monitor/threats"]
        MN3["GET /monitor/layers/{layer}"]
        MN4["WS  /monitor/stream"]
    end

    subgraph GAME_EP["/game/*"]
        G1["GET  /game/profile"]
        G2["POST /game/action"]
        G3["GET  /game/leaderboard"]
        G4["GET  /game/shop"]
        G5["POST /game/purchase"]
    end

    subgraph BILLING_EP["/billing/*"]
        B1["POST /billing/checkout"]
        B2["GET  /billing/portal"]
        B3["POST /billing/webhook  Stripe"]
        B4["GET  /billing/status"]
    end

    subgraph ADMIN_EP["/admin/*"]
        AD1["GET  /admin/users"]
        AD2["POST /admin/users/{id}/ban"]
        AD3["GET  /admin/metrics"]
        AD4["POST /admin/feature-flags"]
    end

    JWT["🔐 JWT Middleware\nBearer token\nall protected routes"]
    JWT --> MARKETS_EP & COPILOT_EP & PORTFOLIO_EP & COMMUNITY_EP & MONITOR_EP & GAME_EP & BILLING_EP
```

---

## 10. SEC Ingestion Pipeline (Detailed)

```mermaid
flowchart TD
    TRIGGER["⚙️ Trigger\nPOST /copilot/ingest\nor Celery task"]

    subgraph FETCH["① Fetch from EDGAR"]
        F1["CIK Lookup\n/submissions/{ticker}"]
        F2["Filing URL resolver\n/Archives/EDGAR/data/..."]
        F3["HTML content fetch\n(rate-limited: 10 req/s)"]
    end

    subgraph PARSE["② Parse + Clean"]
        P1["lxml HTML parser\nbeautifulsoup4"]
        P2["Section extractor\n(Item 1, 1A, 7, 7A, 8...)"]
        P3["Text normalizer\n(strip HTML, fix whitespace)"]
        P4["Metadata tagger\n(ticker · filing_type\nfiscal_year · section\nfiled_date)"]
    end

    subgraph CHUNK["③ Chunk"]
        C1["sentence-transformers\nSentenceWindowNodeParser\n(lazy import — avoids\nPyTorch at startup)"]
        C2["512-token windows\n128-token overlap\nParent-Child pairs created"]
    end

    subgraph EMBED["④ Embed"]
        E1["Bedrock Titan v2\namazon.titan-embed-text-v2:0\n1536-dim vectors"]
        E2["OpenAI fallback\ntext-embedding-3-small\n1536-dim (same schema)"]
    end

    subgraph INDEX["⑤ Index in Qdrant"]
        I1["Collection: sec_filings\nHNSW (m=16, ef=100)\n+ BM42 sparse index"]
        I2["Payload: ticker · filing_type\nfiscal_year · section\nfiled_date · text\nparent_id"]
        I3["Upsert (idempotent)\nbatch 100 points"]
    end

    STATS["📊 Result\n36,627 chunks indexed\nMSFT(9.6K) TSLA(9.3K)\nAAPL(8.1K) AMZN NVDA\nNFLX ORCL QCOM GOOGL IBM"]

    TRIGGER --> F1 --> F2 --> F3
    F3 --> P1 --> P2 --> P3 --> P4
    P4 --> C1 --> C2
    C2 --> E1
    E1 -->|"fail → fallback"| E2
    E1 & E2 --> I1 --> I2 --> I3 --> STATS
```

---

## 11. Feature → Module Map

```mermaid
mindmap
  root((QuantTrade AI))
    Markets
      Real-time quotes (Finnhub WebSocket)
      Candlestick charts (TradingView / Alpaca OHLC)
      Market Heatmap (sector heat)
      Top Movers
      Economic Calendar
      News Feed (Finnhub + NewsAPI)
      Technical Indicators (Alpha Vantage RSI/MACD/SMA)
    Copilot RAG
      6 specialized agents
      LangGraph supervisor state machine
      HyDE → Hybrid Search → Rerank → Parent-Child
      36K SEC filings (10-K/10-Q/8-K)
      SSE token streaming
      Framer Motion loading scene
      Citation cards + stock panel
    Portfolio
      Multi-portfolio CRUD
      Position tracking (avg cost, P&L)
      Performance chart
      Risk metrics
      Alerts (price targets)
    Screener
      Filter by sector / market cap / P/E
      Custom criteria builder
      Save/load screens
    Community (Quant-Agora)
      Posts with media
      Reactions + comments
      Follow/unfollow
      DMs (polling)
      User search
      Reddit-style redesign
    Global Monitor
      12-layer intelligence
      Geopolitical events
      Threat classification (Groq LLM)
      Real-time WebSocket stream
    QuantTrade Life
      5 life stages (medieval theme)
      Gold economy
      XP progression
      Item shop
      Quest system
      Leaderboard
    Auth & Identity
      Email + OTP (Brevo)
      Google OAuth 2.0
      WebAuthn Passkey (FIDO2)
      JWT access tokens
      Refresh token rotation
    Billing
      Stripe subscriptions
      Free / Plus plans
      Customer portal
      Webhook handlers
    Admin
      User management
      Ban / suspend
      Platform metrics
      Feature flags
    Infrastructure
      AWS EC2 t2.small
      Docker Compose
      GitHub Actions CI/CD
      Cloudflare CDN/WAF/TLS
      Neon PostgreSQL
      Qdrant Cloud
      Redis
      Cloudflare R2
```

---

## 12. Current vs Production-Scale Gap Analysis

| Layer (from diagram) | Current | Production-Scale Next Step |
|---------------------|---------|---------------------------|
| ① EDGE | ✅ Cloudflare CDN+WAF+TLS | Add Cloudflare Workers for edge auth |
| ② ROUTING | ❌ Single EC2 | Add NLB + Route 53 health routing |
| ③ REGION | ❌ us-east-1 only | Add us-west-2 read replica (Neon branching) |
| ④ CELLS | ❌ Monolith | Split Copilot + Markets into separate services |
| ⑤ CLUSTER | ⚠️ Nginx only | Migrate to ECS Fargate or k8s (EKS) |
| ⑥ SERVICE MESH | ❌ Direct Docker network | Add Envoy or use AWS App Mesh |
| ⑦ DATA LAYER | ✅ Hot/Warm/Cold | Add Neon read replica for heavy read traffic |

