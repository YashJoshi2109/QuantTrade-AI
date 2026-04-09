# System Architecture and Data Flow

Below is the complete data flow mapping from user interaction, frontend/backend logic, all the way to primary DB persistence and cache handling.

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
    classDef db fill:#b45309,stroke:#fbbf24,color:#fff
    classDef cache fill:#312e81,stroke:#a5b4fc,color:#fff
    classDef external fill:#4c1d95,stroke:#c084fc,color:#fff
    
    class UI,NextServer frontend
    class API,Services,WS,Celery backend
    class DB db
    class Cache cache
    class ElevenLabs,MarketData external
```

## Render `system_design.puml` (PlantUML)

The PlantUML file uses **`!pragma layout smetana`** so it does **not** require Graphviz (`dot`)—only Java.

1. **Download the JAR** (one-time), e.g. from [PlantUML releases](https://github.com/plantuml/plantuml/releases):

   ```bash
   curl -sL -o plantuml.jar \
     "https://github.com/plantuml/plantuml/releases/download/v1.2024.7/plantuml-1.2024.7.jar"
   ```

2. **Generate PNG** next to the `.puml` file:

   ```bash
   java -jar plantuml.jar -charset UTF-8 doc/system_design.puml
   ```

   Output: `doc/system_design.png`.

**Alternatives**

- **VS Code**: install the “PlantUML” extension, open `system_design.puml`, run the preview / export command.
- **Docker** (if Docker is running):  
  `docker run --rm -v "$PWD/doc:/data" plantuml/plantuml /data/system_design.puml`
- **Homebrew** (installs Graphviz + plantuml):  
  `brew install plantuml` then `plantuml doc/system_design.puml`
