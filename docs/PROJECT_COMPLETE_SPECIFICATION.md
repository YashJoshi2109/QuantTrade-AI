# QuantTrade AII Trading & Research - Complete Project Specification

## PROJECT OVERVIEW

**Name**: QuantTrade AI  
**Description**: A comprehensive AI-powered trading and research platform with TradingView-style UI, featuring real-time market data, AI copilot, RAG-powered insights, and backtesting capabilities.  
**Live App**: https://sunny-hamster-0012a0.netlify.app/  
**Architecture**: Full-stack web application with FastAPI backend, Next.js frontend, PostgreSQL database, and ML/AI services.

---

## TECHNOLOGY STACK

### Backend
- **Framework**: FastAPI 0.104.1 (Python 3.11+)
- **Database**: PostgreSQL 15+ with pgvector extension for vector embeddings
- **ORM**: SQLAlchemy 2.0+ with psycopg3
- **Authentication**: JWT (python-jose), bcrypt for password hashing, Google OAuth
- **Background Jobs**: Celery 5.3.4 with Redis 5.0.1
- **Data Sources**: yfinance 0.2.32, Alpha Vantage API, SEC EDGAR API
- **ML/AI**: 
  - Geminie API (for embeddings and LLM)
  - Geminie  API via LangChain
  - sentence-transformers (all-MiniLM-L6-v2) for local embeddings
  - LangChain 0.3+ for RAG orchestration
  - scikit-learn, XGBoost, LightGBM for ML models
  - SHAP for model explainability
- **Technical Analysis**: ta library for indicators
- **Vector Storage**: pgvector (primary) or Qdrant (optional)
- **Object Storage**: boto3 (S3-compatible) or local storage

### Frontend
- **Framework**: Next.js 14.0.4 with App Router
- **UI Library**: React 18.2
- **Language**: TypeScript 5.3
- **Styling**: Tailwind CSS 3.4
- **Charts**: TradingView Lightweight Charts 4.1.3
- **State Management**: 
  - React Query (TanStack Query) 5.17 for server state
  - Zustand 4.4 for global UI state
- **HTTP Client**: Axios 1.6.2
- **Animations**: GSAP 3.14.2
- **Icons**: Lucide React 0.303

### Infrastructure
- **Database Hosting**: Render PostgreSQL (external connection) if u can able to build database by ureself u can
- **Containerization**: Docker & Docker Compose (optional) not necessary
- **Deployment**: Netlify (frontend), Render/Cloud (backend)

---

## DATABASE SCHEMA

### Tables

#### 1. `symbols` - Stock Symbol Metadata
```python
- id: Integer (Primary Key)
- symbol: String(10) (Unique, Indexed) - e.g., "AAPL"
- name: String(255) - Company name
- sector: String(100) - e.g., "Technology"
- industry: String(100) - e.g., "Consumer Electronics"
- market_cap: Float - Market capitalization
- created_at: DateTime (timezone=True)
- updated_at: DateTime (timezone=True)
```

#### 2. `price_bars` - OHLCV Historical Data
```python
- id: Integer (Primary Key)
- symbol_id: Integer (ForeignKey -> symbols.id)
- timestamp: DateTime (timezone=True, Indexed)
- open: Float
- high: Float
- low: Float
- close: Float
- volume: Integer
- Index: (symbol_id, timestamp) for efficient queries
```

#### 3. `users` - User Accounts
```python
- id: Integer (Primary Key)
- email: String(255) (Unique, Indexed)
- username: String(100) (Unique, Indexed)
- hashed_password: String(255) (Nullable for OAuth)
- full_name: String(255) (Nullable)
- google_id: String(255) (Unique, Nullable) - For Google OAuth
- avatar_url: Text (Nullable)
- is_active: Boolean (default=True)
- is_verified: Boolean (default=False)
- created_at: DateTime
- updated_at: DateTime
- last_login: DateTime (Nullable)
```

#### 4. `news_articles` - News Articles
```python
- id: Integer (Primary Key)
- symbol_id: Integer (ForeignKey -> symbols.id, Indexed)
- title: String(500)
- content: Text
- source: String(100)
- url: String(1000)
- published_at: DateTime (timezone=True, Indexed)
- sentiment: String(20) - 'Bullish', 'Bearish', 'Neutral'
- created_at: DateTime (timezone=True)
- Index: (symbol_id, published_at) for efficient queries
```

#### 5. `filings` - SEC Filings
```python
- id: Integer (Primary Key)
- symbol_id: Integer (ForeignKey -> symbols.id, Indexed)
- form_type: String(20) - '10-K', '10-Q', '8-K', etc.
- filing_date: DateTime (timezone=True, Indexed)
- period_end_date: DateTime (timezone=True) (Nullable)
- accession_number: String(50) (Unique)
- url: String(1000)
- content: Text - Full filing text
- summary: Text - AI-generated summary
- created_at: DateTime (timezone=True)
- Index: (symbol_id, filing_date)
```

#### 6. `filing_chunks` - Chunked Filing Content for RAG
```python
- id: Integer (Primary Key)
- filing_id: Integer (ForeignKey -> filings.id, Indexed)
- chunk_index: Integer
- content: Text
- section: String(100) - e.g., "Risk Factors", "Management Discussion"
- embedding: Text (JSON array) - Vector embedding (will be Vector type with pgvector)
- created_at: DateTime (timezone=True)
- Index: (filing_id, chunk_index)
```

#### 7. `watchlists` - User Watchlists
```python
- id: Integer (Primary Key)
- user_id: Integer (ForeignKey -> users.id, ondelete="CASCADE", Nullable)
- legacy_user_id: String(100) (Indexed, Nullable) - For backwards compatibility
- symbol_id: Integer (ForeignKey -> symbols.id)
- created_at: DateTime (timezone=True)
- notes: String(500) (Nullable)
```

#### 8. `chat_history` - AI Copilot Chat History
```python
- id: Integer (Primary Key)
- user_id: Integer (ForeignKey -> users.id, ondelete="SET NULL", Nullable)
- session_id: String(64) (Indexed, Nullable) - Groups related messages
- symbol: String(20) (Indexed, Nullable) - Related symbol
- role: String(20) - "user" or "assistant"
- content: Text
- created_at: DateTime (timezone=True, Indexed)
```

---

## BACKEND API ENDPOINTS

All endpoints are prefixed with `/api/v1`

### Authentication (`/api/v1/auth`)

#### POST `/auth/register`
Register new user with email/password.
**Request Body**:
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "password",
  "full_name": "Full Name" (optional)
}
```
**Response**: `TokenResponse` with `access_token`, `token_type: "bearer"`, `user` object

#### POST `/auth/login`
Login with email/password.
**Request Body**: `{ "email": "...", "password": "..." }`
**Response**: `TokenResponse`

#### POST `/auth/google`
Login/register with Google OAuth (legacy endpoint).
**Request Body**:
```json
{
  "google_id": "...",
  "email": "...",
  "name": "...",
  "avatar_url": "..." (optional)
}
```
**Response**: `TokenResponse`

#### POST `/auth/google/verify`
Verify Google ID token (recommended endpoint).
**Request Body**: `{ "credential": "google_id_token" }`
**Response**: `TokenResponse`

#### GET `/auth/me`
Get current user info (requires authentication).
**Headers**: `Authorization: Bearer <token>`
**Response**: `UserResponse` object

#### GET `/auth/session`
Check if user is authenticated (optional auth).
**Headers**: `Authorization: Bearer <token>` (optional)
**Response**: `{ "authenticated": boolean, "user": UserResponse | null }`

#### POST `/auth/logout`
Logout (client should delete token).
**Response**: `{ "message": "Logged out successfully" }`

---

### Symbols (`/api/v1/symbols`)

#### GET `/symbols`
List symbols with optional search filter.
**Query Params**: `search?: string` - Filter by symbol or name
**Response**: `List[SymbolResponse]` (max 100 results)

#### GET `/symbols/{symbol}`
Get symbol details by ticker.
**Response**: `SymbolResponse`

#### POST `/symbols/{symbol}/sync`
Sync symbol data and price data from external sources.
**Response**: `{ "symbol": "...", "bars_inserted": number, "message": "..." }`

---

### Prices (`/api/v1/prices`)

#### GET `/prices/{symbol}`
Get price bars (OHLCV) for a symbol.
**Query Params**:
- `start?: datetime` - Start date
- `end?: datetime` - End date
- `limit?: int` (1-5000, default: 500) - Max number of bars
**Response**: `List[PriceBarResponse]`

#### POST `/prices/{symbol}/sync`
Sync price data for a symbol.
**Query Params**: `start?: datetime`, `end?: datetime`
**Response**: `{ "symbol": "...", "bars_inserted": number, "message": "..." }`

#### GET `/prices/{symbol}/quote`
Get live quote from Alpha Vantage or database.
**Response**: Quote object with `symbol`, `price`, `change`, `change_percent`, `volume`, `high`, `low`, `open`, `previous_close`, `timestamp`

---

### Indicators (`/api/v1/indicators`)

#### GET `/indicators/{symbol}`
Get technical indicators for a symbol.
**Response**:
```json
{
  "symbol": "...",
  "indicators": {
    "current_price": number | null,
    "sma_20": number | null,
    "sma_50": number | null,
    "sma_200": number | null,
    "rsi": number | null,
    "macd": {
      "macd": number | null,
      "signal": number | null,
      "histogram": number | null
    },
    "bollinger_bands": {
      "upper": number | null,
      "middle": number | null,
      "lower": number | null
    }
  }
}
```

---

### News (`/api/v1/news`)

#### GET `/news/{symbol}`
Get news articles for a symbol.
**Query Params**:
- `limit?: int` (1-100, default: 20)
- `start_date?: datetime`
- `end_date?: datetime`
- `sentiment?: string` - Filter by 'Bullish', 'Bearish', 'Neutral'
**Response**: `List[NewsArticleResponse]`

#### POST `/news/{symbol}/sync`
Sync news articles from Alpha Vantage.
**Query Params**: `use_mock?: bool` (default: false) - Use mock data for testing
**Response**: `{ "symbol": "...", "articles_synced": number, "message": "...", "source": "..." }`

#### GET `/news/live/market`
Get live market news from Alpha Vantage (no database storage).
**Query Params**:
- `topics?: string` (default: "technology,earnings") - Comma-separated topics
- `limit?: int` (1-50, default: 20)
**Response**: `{ "news": [...], "count": number, "topics": string }`

#### GET `/news/live/{symbol}`
Get live news for a specific symbol from Alpha Vantage.
**Query Params**: `limit?: int` (1-50, default: 10)
**Response**: `{ "news": [...], "count": number, "symbol": string }`

---

### Filings (`/api/v1/filings`)

#### GET `/filings/{symbol}`
Get SEC filings for a symbol.
**Query Params**:
- `form_type?: string` - Filter by form type (e.g., "10-K", "10-Q")
- `limit?: int` (1-100, default: 20)
**Response**: `List[FilingResponse]`

#### GET `/filings/{symbol}/{filing_id}`
Get detailed filing content.
**Response**: Filing object with `content`, `summary`, `chunks_count`

#### POST `/filings/{symbol}/sync`
Sync SEC filings for a symbol.
**Query Params**: `use_mock?: bool` (default: true)
**Response**: `{ "symbol": "...", "filings_synced": number, "message": "..." }`

---

### Risk (`/api/v1/risk`)

#### GET `/risk/{symbol}`
Get risk metrics for a symbol.
**Response**:
```json
{
  "symbol": "...",
  "risk_score": number (0-100),
  "risk_level": "Low" | "Medium" | "High",
  "factors": {
    "volatility": number,
    "max_drawdown": number,
    "beta": number,
    "rsi": number | null
  },
  "breakdown": {
    "volatility_contribution": number,
    "drawdown_contribution": number,
    "beta_contribution": number,
    "momentum_contribution": number
  }
}
```

#### GET `/risk/portfolio`
Get portfolio risk metrics (Phase 3 - placeholder).
**Query Params**: `user_id: string`
**Response**: Placeholder response

---

### Watchlist (`/api/v1/watchlist`)

#### GET `/watchlist`
Get user's watchlist (requires authentication).
**Headers**: `Authorization: Bearer <token>`
**Response**: `List[WatchlistItemResponse]` or empty array if not authenticated

#### POST `/watchlist`
Add symbol to watchlist (requires authentication).
**Request Body**: `{ "symbol": "..." }`
**Response**: `{ "id": number, "symbol": "...", "message": "..." }`

#### DELETE `/watchlist/{symbol}`
Remove symbol from watchlist (requires authentication).
**Response**: `{ "message": "Removed from watchlist" }`

---

### Backtest (`/api/v1/backtest`)

#### POST `/backtest`
Run a backtest.
**Request Body**:
```json
{
  "symbol": "...",
  "start_date": "datetime",
  "end_date": "datetime",
  "strategy": "rsi_ma_crossover" | "ma_crossover",
  "initial_capital": number (default: 10000.0)
}
```
**Response**:
```json
{
  "symbol": "...",
  "strategy": "...",
  "initial_capital": number,
  "final_equity": number,
  "total_return": number (%),
  "total_trades": number,
  "win_rate": number (%),
  "max_drawdown": number (%),
  "sharpe_ratio": number,
  "equity_curve": number[],
  "trades": [...]
}
```

#### GET `/strategies`
Get available strategy templates.
**Response**: `{ "strategies": [...] }` - List of strategy objects with `id`, `name`, `description`

---

### Chat (`/api/v1/chat`)

#### POST `/chat`
AI copilot chat endpoint with RAG.
**Request Body**:
```json
{
  "message": "...",
  "symbol": "..." (optional),
  "include_news": boolean (default: true),
  "include_filings": boolean (default: true),
  "top_k": number (default: 5),
  "session_id": "..." (optional) - UUID for grouping messages
}
```
**Headers**: `Authorization: Bearer <token>` (optional - for chat history)
**Response**:
```json
{
  "response": "string",
  "sources": string[],
  "context_docs": number,
  "symbol": string | null,
  "session_id": string
}
```

#### GET `/chat/history`
Get chat history for authenticated user (duplicate - also in chat_history endpoint).

---

### Market (`/api/v1/market`)

#### GET `/market/stocks`
Get all stocks with performance data.
**Query Params**:
- `sector?: string` - Filter by sector
- `limit?: int` (1-500, default: 100)
**Response**: `List[StockPerformance]`

#### GET `/market/sectors`
Get sector performance with stocks.
**Response**: `List[SectorPerformance]`

#### GET `/market/heatmap`
Get market heatmap data for visualization.
**Response**: `HeatmapData` with `sectors`, `total_stocks`, `gainers`, `losers`, `unchanged`

#### GET `/market/gainers`
Get top gaining stocks.
**Query Params**: `limit?: int` (1-50, default: 10)
**Response**: `List[StockPerformance]`

#### GET `/market/losers`
Get top losing stocks.
**Query Params**: `limit?: int` (1-50, default: 10)
**Response**: `List[StockPerformance]`

#### GET `/market/movers`
Get market movers (gainers and losers combined).
**Response**: `{ "gainers": [...], "losers": [...], "updated_at": "..." }`

---

### Market Status (`/api/v1/market/status`)

#### GET `/market/status`
Get current market status (NYSE/NASDAQ open/closed).
**Response**:
```json
{
  "is_open": boolean,
  "status": "OPEN" | "CLOSED",
  "current_time_et": "string",
  "market_open": "string",
  "market_close": "string",
  "is_weekday": boolean,
  "exchanges": {
    "NYSE": boolean,
    "NASDAQ": boolean
  }
}
```

---

### Chat History (`/api/v1/chat/history`)

#### GET `/chat/history`
Get chat history for authenticated user.
**Query Params**:
- `limit?: int` (default: 50)
- `session_id?: string` - Filter by session
**Headers**: `Authorization: Bearer <token>`
**Response**: `List[ChatHistoryItem]`

#### DELETE `/chat/history`
Clear chat history for authenticated user.
**Query Params**: `session_id?: string` - Clear specific session or all
**Headers**: `Authorization: Bearer <token>`
**Response**: `{ "message": "Deleted N messages" }`

---

## BACKEND SERVICES

### 1. DataFetcher (`app/services/data_fetcher.py`)
Fetches market data from Alpha Vantage (primary) and yfinance (fallback).

**Methods**:
- `fetch_symbol_info(symbol: str) -> dict`: Fetch basic symbol information
- `fetch_historical_data_alpha_vantage(symbol: str, outputsize: str = "full") -> pd.DataFrame`: Fetch from Alpha Vantage
- `fetch_historical_data(symbol: str, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None, period: str = "1y") -> pd.DataFrame`: Main fetch method with fallback
- `sync_symbol_to_db(db: Session, symbol: str) -> Symbol`: Sync symbol info to database
- `sync_price_data_to_db(db: Session, symbol: str, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None) -> int`: Sync price data, returns count of bars inserted

---

### 2. IndicatorService (`app/services/indicators.py`)
Computes technical indicators from price data.

**Methods**:
- `get_price_dataframe(db: Session, symbol_id: int, limit: int = 500) -> pd.DataFrame`: Get price data as DataFrame
- `compute_sma(df: pd.DataFrame, period: int = 20) -> pd.Series`: Simple Moving Average
- `compute_ema(df: pd.DataFrame, period: int = 20) -> pd.Series`: Exponential Moving Average
- `compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series`: Relative Strength Index
- `compute_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> Dict[str, pd.Series]`: MACD indicator
- `compute_bollinger_bands(df: pd.DataFrame, period: int = 20, std_dev: int = 2) -> Dict[str, pd.Series]`: Bollinger Bands
- `get_all_indicators(db: Session, symbol_id: int, periods: Optional[Dict[str, int]] = None) -> Dict`: Get all computed indicators

**Computed Indicators**:
- SMA: 20, 50, 200 periods
- RSI: 14 period
- MACD: Fast 12, Slow 26, Signal 9
- Bollinger Bands: 20 period, 2 standard deviations

---

### 3. NewsFetcher (`app/services/news_fetcher.py`)
Fetches news articles from Alpha Vantage.

**Methods**:
- `fetch_alpha_vantage_news(symbol: str, limit: int = 50) -> List[Dict]`: Fetch from Alpha Vantage
- `fetch_mock_news(symbol: str, count: int = 10) -> List[Dict]`: Generate mock news for testing
- `_parse_sentiment(score: float) -> str`: Parse sentiment score to label (Bullish/Bearish/Neutral)
- `save_articles_to_db(db: Session, symbol: Symbol, articles: List[Dict]) -> int`: Save articles to database
- `sync_news_for_symbol(db: Session, symbol: str, use_mock: bool = False) -> int`: Main sync method

**Sentiment Scoring**:
- Score > 0.15: "Bullish"
- Score < -0.15: "Bearish"
- Otherwise: "Neutral"

---

### 4. FilingsFetcher (`app/services/filings_fetcher.py`)
Fetches and processes SEC filings.

**Methods**:
- `get_cik_for_symbol(symbol: str) -> Optional[str]`: Get CIK for ticker (mock mapping for Phase 2)
- `fetch_mock_filings(symbol: str, count: int = 5) -> List[Dict]`: Generate mock filings
- `_generate_mock_filing_content(symbol: str, form_type: str) -> str`: Generate mock filing content
- `chunk_filing_content(content: str, chunk_size: int = 1000, overlap: int = 200) -> List[Dict]`: Split filing into chunks for RAG
- `save_filing_to_db(db: Session, symbol: Symbol, filing_data: Dict, chunk_content: bool = True) -> Filing`: Save filing and chunks
- `sync_filings_for_symbol(db: Session, symbol: str, use_mock: bool = True) -> int`: Main sync method

**Filing Chunking**:
- Splits by sections (e.g., "RISK FACTORS", "MANAGEMENT DISCUSSION")
- Chunk size: 1000 characters with 200 character overlap
- Stores section metadata with each chunk

---

### 5. RAGService (`app/services/rag_service.py`)
RAG (Retrieval-Augmented Generation) service using Claude (Anthropic) for document retrieval and generation.

**Initialization**:
- Uses Geminie via LangChain
- Temperature: 0.7, Max tokens: 1024
- Lazy initialization of LLM

**Methods**:
- `retrieve_filing_chunks(db: Session, query: str, symbol_id: Optional[int] = None, top_k: int = 5) -> List[Dict]`: Retrieve relevant filing chunks using vector similarity
- `retrieve_news(db: Session, query: str, symbol_id: Optional[int] = None, top_k: int = 10) -> List[Dict]`: Retrieve relevant news articles
- `generate_response(query: str, context_docs: List[Dict], symbol: Optional[str] = None) -> Dict`: Generate response using Geminie with RAG context
- `_generate_smart_response(query: str, context_docs: List[Dict], symbol: Optional[str] = None) -> str`: Fallback response generator without LLM
- `query(db: Session, query: str, symbol: Optional[str] = None, symbol_id: Optional[int] = None, include_news: bool = True, include_filings: bool = True, top_k: int = 10) -> Dict`: Complete RAG query: retrieve + generate

**RAG Flow**:
1. User query is embedded using EmbeddingService
2. Relevant documents retrieved from database (filings chunks, news)
3. Context is built from retrieved documents
4. Geminie LLM generates response with context
5. Response includes sources and document count

**Fallback Behavior**:
- If Geminie unavailable, uses `_generate_smart_response` with rule-based sentiment analysis
- Analyzes sentiment from news articles
- Provides structured response with bullet points

---

### 6. EmbeddingService (`app/services/embedding_service.py`)
Generates text embeddings for vector similarity search.

**Model**: sentence-transformers "all-MiniLM-L6-v2"
- Dimension: 384
- Fast, good quality embeddings

**Methods**:
- `embed_text(text: str) -> List[float]`: Generate embedding for single text
- `embed_batch(texts: List[str], batch_size: int = 32) -> List[List[float]]`: Generate embeddings for multiple texts
- `update_filing_chunk_embeddings(chunks: List, embeddings: List[List[float]])`: Update chunk objects with embeddings
- `similarity(embedding1: List[float], embedding2: List[float]) -> float`: Calculate cosine similarity between embeddings

**Storage**:
- Embeddings stored as JSON strings in `filing_chunks.embedding` column
- Will be migrated to pgvector Vector type in production

---

### 7. BacktestEngine (`app/services/backtest_engine.py`)
Rule-based strategy and LLm - machine learning hybrid strategy backtesting engine.

**Trade Class**:
- `entry_date`, `entry_price`, `quantity`
- `exit_date`, `exit_price`, `pnl`, `return_pct`
- `close(exit_date, exit_price)`: Calculate PnL and return

**BacktestEngine Class**:
- `run_backtest(db: Session, symbol_id: int, start_date: datetime, end_date: datetime, strategy_func: Callable, initial_capital: float = 10000.0) -> Dict`: Run backtest
  - Calculates indicators (SMA 20/50, RSI)
  - Executes strategy function on each bar
  - Tracks position, cash, equity curve
  - Calculates metrics: total return, win rate, max drawdown, Sharpe ratio

**Strategy Templates**:
- `rsi_ma_crossover_strategy(current_bar, prev_bar, position)`: Buy when RSI < 30 and price > SMA 20, sell when RSI > 70 or price < SMA 20
- `ma_crossover_strategy(current_bar, prev_bar, position)`: Buy when SMA 20 crosses above SMA 50, sell when crosses below

**Metrics Calculated**:
- Total return (%)
- Final equity
- Total trades
- Win rate (%)
- Max drawdown (%)
- Sharpe ratio (annualized)
- Equity curve (array)
- Individual trade details

---

### 8. RiskScorer (`app/services/risk_scorer.py`)
Calculates risk metrics and scores.

**Methods**:
- `calculate_volatility(db: Session, symbol_id: int, period_days: int = 30) -> float`: Calculate rolling volatility (annualized %)
- `calculate_max_drawdown(db: Session, symbol_id: int, period_days: int = 252) -> float`: Calculate maximum drawdown (%)
- `calculate_beta(db: Session, symbol_id: int, market_symbol: str = "SPY", period_days: int = 252) -> Optional[float]`: Calculate beta vs market (placeholder in Phase 3)
- `calculate_risk_score(db: Session, symbol_id: int) -> Dict`: Comprehensive risk score

**Risk Score Calculation** (0-100, higher = riskier):
- Volatility score: min(volatility * 2, 40) - Max 40 points
- Drawdown score: min(max_drawdown * 1.5, 30) - Max 30 points
- Beta score: abs(beta - 1) * 10 - Max 20 points
- Momentum score: abs(rsi - 50) / 50 * 10 - Max 10 points

**Risk Levels**:
- 70+: "High"
- 40-69: "Medium"
- <40: "Low"

---

### 9. ML Models (`app/services/ml_models.py`)
ML models for risk scoring and sentiment analysis (framework ready, not yet trained).

**RiskScoringModel**:
- Uses GradientBoostingRegressor (if any better you know use that as well)(100 estimators)
- Features: volatility, beta, max_drawdown, momentum, volume_ratio, rsi, macd_signal
- Methods: `prepare_features()`, `train()`, `predict()`, `explain()` (using SHAP)

**SentimentClassifier**:
- Uses RandomForestClassifier and XGBoost (and if better u know) (100 estimators)
- Classifies as: Bearish (0), Neutral (1), Bullish (2)
- Methods: `train()`, `predict()`, `predict_proba()`
- Fallback: `_rule_based_sentiment()` if not trained

---

### 10. VectorStore (`app/services/vector_store.py`)
Unified interface for vector storage (pgvector or Qdrant).

**Supported Backends**:
- pgvector (PostgreSQL extension) - Primary
- Qdrant (dedicated vector DB) - Optional

**Methods**:
- `store_embeddings(collection_name: str, embeddings: List[List[float]], metadata: List[Dict], ids: Optional[List[str]] = None)`
- `search(collection_name: str, query_embedding: List[float], top_k: int = 10, filter: Optional[Dict] = None) -> List[Dict]`

**Status**: Framework ready, full implementation pending

---

### 11. StorageService (`app/services/storage.py`)
Object storage service for files (S3-compatible or local).

**Storage Backends**:
- S3-compatible (boto3) - Production
- Local storage - Development

**Methods**:
- `upload_file(file_path: str, object_name: str, bucket: Optional[str] = None) -> bool`
- `download_file(object_name: str, local_path: str, bucket: Optional[str] = None) -> bool`
- `delete_file(object_name: str, bucket: Optional[str] = None) -> bool`

---

## AUTHENTICATION & AUTHORIZATION

### JWT Authentication
- **Secret Key**: From `settings.SECRET_KEY` (default: "7730eae563847420772c890ecb062bb7")
- **Algorithm**: HS256
- **Token Expiry**: 7 days (ACCESS_TOKEN_EXPIRE_DAYS)
- **Token Format**: `{"sub": user_id, "exp": expiry, "iat": issued_at}`

### Password Hashing
- Uses bcrypt via passlib
- `hash_password(password: str) -> str`: Hash password
- `verify_password(password: str, hashed: str) -> bool`: Verify password

### Google OAuth
- Supports Google ID token verification
- Auto-links Google account to existing email if found
- Generates unique username from email if new user

### Auth Helpers
- `get_current_user()`: Optional auth - returns User or None
- `require_auth()`: Required auth - raises 401 if not authenticated
- `create_access_token(user_id: int) -> str`: Generate JWT token
- `decode_token(token: str) -> Optional[int]`: Decode token to user_id

---

## CONFIGURATION

### Environment Variables (`app/config.py`)

**Database**:
- `DATABASE_URL`: PostgreSQL connection string (auto-converted to postgresql+psycopg://)
- `RENDER_DATABASE_URL`: Alternative database URL
- `NETLIFY_DATABASE_URL`: Alternative database URL

**JWT Auth**:
- `SECRET_KEY`: JWT secret key
- `ALGORITHM`: "HS256"
- `ACCESS_TOKEN_EXPIRE_MINUTES`: 30 (not used, uses ACCESS_TOKEN_EXPIRE_DAYS = 7)

**API Keys**:
- `Geminie KEy`:  API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `ALPHA_VANTAGE_API_KEY`: Alpha Vantage API key
- `BYTEZ_API_KEY`: Bytez API key

**Google OAuth**:
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret

**Vector DB**:
- `VECTOR_STORE_BACKEND`: "pgvector" or "qdrant"
- `QDRANT_URL`: "http://localhost:6333"
- `CHROMA_PERSIST_DIR`: "./chroma_db"

**Celery/Redis**:
- `CELERY_BROKER_URL`: "redis://localhost:6379/0"
- `CELERY_RESULT_BACKEND`: "redis://localhost:6379/0"

**Object Storage**:
- `S3_ENDPOINT`: S3 endpoint URL
- `S3_ACCESS_KEY`: S3 access key
- `S3_SECRET_KEY`: S3 secret key
- `S3_BUCKET`: S3 bucket name
- `USE_LOCAL_STORAGE`: True (use local storage)
- `LOCAL_STORAGE_PATH`: "./storage"

**App Settings**:
- `DEBUG`: True
- `LOG_LEVEL`: "INFO"
- `DEFAULT_SYMBOLS`: "AAPL,MSFT,GOOGL,AMZN,TSLA,META,NVDA,JPM,V,JNJ"

---

## FRONTEND ARCHITECTURE

### Pages (`frontend/src/app/`)

1. **`/` (Homepage)** - `page.tsx`
   - Market status card
   - Market movers (gainers/losers)
   - Sector performance
   - Market heatmap
   - Live news feed
   - Quick access to research, backtest, ideas lab

2. **`/research`** - `research/page.tsx`
   - Symbol search and selection
   - TradingView-style chart
   - Technical indicators panel
   - Key statistics
   - News panel
   - AI Copilot panel (RAG chat)

3. **`/backtest`** - `backtest/page.tsx`
   - Strategy selection
   - Date range picker
   - Initial capital input
   - Backtest results visualization
   - Performance metrics display

4. **`/ideas-lab`** - `ideas-lab/page.tsx`
   - Strategy builder interface
   - Backtest results
   - AI-powered insights

5. **`/watchlist`** - `watchlist/page.tsx`
   - User's watchlist display
   - Add/remove symbols
   - Portfolio overview

6. **`/markets`** - `markets/page.tsx`
   - Market heatmap
   - Sector performance
   - Top gainers/losers
   - Market overview

7. **`/auth`** - `auth/page.tsx`
   - Login form
   - Register form
   - Google OAuth button

8. **`/settings`** - `settings/page.tsx`
   - User settings
   - Preferences

### Components (`frontend/src/components/`)

1. **AppLayout** - Main layout wrapper with sidebar and header
2. **Header** - Top navigation bar
3. **Sidebar** - Navigation menu
4. **Chart** - TradingView Lightweight Charts integration
5. **SymbolSearch** - Symbol search input with autocomplete
6. **SymbolHeader** - Symbol info display (name, price, change)
7. **IndicatorsPanel** - Technical indicators display
8. **KeyStatistics** - Key stats (market cap, sector, etc.)
9. **NewsPanel** - News articles list
10. **LiveNews** - Live market news feed
11. **CopilotPanel** - AI chat interface with RAG
12. **BacktestPanel** - Backtest configuration and results
13. **MarketHeatmap** - Market heatmap visualization
14. **ErrorBoundary** - Error handling component
15. **AnimatedComponents** - GSAP animations

### State Management

**React Query (TanStack Query)**:
- Manages all server state (API calls, caching, synchronization)
- Automatic refetching and caching
- Optimistic updates

**Zustand Store** (`lib/store.ts`):
- `selectedSymbol`: Currently selected symbol
- `activeTab`: Active tab identifier
- `user`: User object (id, email, token)

**Auth Context** (`contexts/AuthContext.tsx`):
- Manages authentication state
- Provides `user`, `isAuthenticated`, `isLoading`
- Methods: `login()`, `logout()`, `register()`, `checkSession()`

### API Client (`lib/api.ts`)

All API functions return TypeScript interfaces matching backend responses:
- `fetchSymbols(search?: string): Promise<Symbol[]>`
- `fetchPrices(symbol: string, start?: string, end?: string): Promise<PriceBar[]>`
- `fetchIndicators(symbol: string): Promise<Indicators>`
- `fetchNews(symbol: string, limit?: number, sentiment?: string): Promise<NewsArticle[]>`
- `sendChatMessage(message: ChatMessage): Promise<ChatResponse>`
- `fetchRiskMetrics(symbol: string): Promise<RiskMetrics>`
- `getWatchlist(): Promise<any[]>`
- `addToWatchlist(symbol: string): Promise<any>`
- `removeFromWatchlist(symbol: string): Promise<any>`
- `runBacktest(request: BacktestRequest): Promise<BacktestResult>`
- `fetchLiveMarketNews(topics?: string, limit?: number): Promise<LiveNewsResponse>`
- `fetchMarketStatus(): Promise<MarketStatus>`
- `fetchSectorPerformance(): Promise<SectorPerformance[]>`
- `fetchHeatmapData(): Promise<HeatmapData>`
- `fetchMarketMovers(): Promise<MarketMovers>`
- `fetchQuote(symbol: string): Promise<QuoteData>`

### Auth Client (`lib/auth.ts`)

- `register(email, username, password, fullName?): Promise<AuthResponse>`
- `login(email, password): Promise<AuthResponse>`
- `googleLogin(googleId, email, name, avatarUrl?): Promise<AuthResponse>`
- `googleVerify(credential): Promise<AuthResponse>`
- `checkSession(): Promise<{ authenticated: boolean, user: User | null }>`
- `logout(): void`
- `getToken(): string | null`
- `getUser(): User | null`
- `getAuthHeaders(): Record<string, string>`

---

## DATA FLOW

### Market Data Flow
```
External API (yfinance/Alpha Vantage) 
  → DataFetcher Service 
  → PostgreSQL (symbols, price_bars) 
  → API Endpoint 
  → Frontend (React Query)
  → UI Components
```

### RAG Flow (Chat)
```
User Message 
  → Chat API Endpoint
  → RAGService.query()
    → EmbeddingService.embed_text(query)
    → Retrieve filing chunks (vector similarity)
    → Retrieve news (keyword matching)
    → Build context from documents
    → Geminie LLM generates response
    → Save to chat_history
  → Response with sources
  → Frontend displays response
```

### News Sync Flow
```
Alpha Vantage API (NEWS_SENTIMENT)
  → NewsFetcher.fetch_alpha_vantage_news()
  → Parse sentiment scores
  → NewsFetcher.save_articles_to_db()
  → PostgreSQL (news_articles)
  → Available via /api/v1/news/{symbol}
```

### Filing Sync Flow
```
SEC EDGAR API (or mock)
  → FilingsFetcher.fetch_mock_filings()
  → FilingsFetcher.chunk_filing_content()
  → EmbeddingService.embed_batch() (optional - for vector search)
  → FilingsFetcher.save_filing_to_db()
  → PostgreSQL (filings, filing_chunks)
  → Available via /api/v1/filings/{symbol}
```

### Backtest Flow
```
User selects strategy and date range
  → POST /api/v1/backtest
  → BacktestEngine.run_backtest()
    → Fetch price data
    → Calculate indicators (SMA, RSI)
    → Execute strategy function on each bar
    → Track positions and trades
    → Calculate metrics (return, drawdown, Sharpe)
  → Return results
  → Frontend visualizes equity curve and metrics
```

---

## DEVELOPMENT PHASES

### Phase 1: Core Data + Basic UI ✅ COMPLETE
- Backend API with symbol and price endpoints
- Database schema for symbols and price bars
- Data sync scripts
- Frontend with symbol search
- Candlestick chart with TradingView Lightweight Charts
- Basic technical indicators (SMA, RSI, MACD, Bollinger Bands)

### Phase 2: News/Filings + RAG Foundation ✅ COMPLETE
- News API integration (Alpha Vantage)
- SEC filings fetcher (mock data ready)
- Document preprocessing and chunking
- Embedding generation service
- RAG retriever implementation
- LLM agent with Claude (Anthropic)
- Chat API endpoint
- Frontend chat panel component

### Phase 3: Quant Metrics + Risk ✅ COMPLETE
- Additional technical indicators
- Volatility calculations
- Drawdown analysis
- Risk score model (volatility + drawdown + sentiment)
- Watchlist CRUD endpoints
- Portfolio aggregation logic
- Risk dashboard UI
- Watchlist view component

### Phase 4: Strategy Backtesting ✅ COMPLETE
- Strategy rule parser
- Strategy templates (RSI + MA crossover, MA crossover)
- Backtest engine with trade simulation
- Performance metrics calculation (CAGR, Sharpe, max DD)
- Equity curve generation
- Backtest API endpoint
- Ideas Lab UI page
- Backtest results visualization

### Phase 5: Polish & Production ⏳ ONGOING
- Loading states and error boundaries
- Form validation
- Responsive design improvements
- Dark/light theme toggle
- Performance optimization
- Logging infrastructure
- Metrics dashboard
- API documentation (OpenAPI/Swagger)
- Deployment configuration
- CI/CD pipeline

---

## KEY DESIGN DECISIONS

1. **pgvector vs Qdrant**: Start with pgvector for simplicity, can migrate to Qdrant for scale
2. **React Query**: Handles all server state, reduces boilerplate
3. **Zustand**: Minimal global state, avoids prop drilling
4. **Celery**: Standard Python async task solution (configured, not yet heavily used)
5. **LangChain**: Industry-standard RAG framework
6. **Claude + sentence-transformers**: Best of both worlds - reliability + flexibility
7. **Alpha Vantage Primary**: More reliable than yfinance for real-time data
8. **Mock Data Fallback**: All data services support mock mode for testing
9. **Soft Failures**: API endpoints return empty data rather than errors where appropriate
10. **JWT with 7-day expiry**: Balance between security and UX

---

## DEPLOYMENT

### Backend
- **Host**: Render or similar cloud provider
- **Database**: Render PostgreSQL (external connection string)
- **Environment Variables**: Set via hosting platform
- **CORS**: Configured for frontend domain and localhost

### Frontend
- **Host**: Netlify
- **Build Command**: `npm run build`
- **Environment Variables**: `NEXT_PUBLIC_API_URL` - Backend API URL
- **API URL**: Points to backend deployment

---

## I have to have this  ENHANCEMENTS as well 

1. **Real SEC Filings**: Replace mock filings with real SEC EDGAR API
2. **Vector Search**: Full pgvector integration for filing chunk search
3. **ML Model Training**: Train risk scoring and sentiment models on historical data
4. **Beta Calculation**: Implement real beta calculation vs SPY
5. **More Strategies**: Additional backtest strategy templates
6. **Portfolio Analytics**: Multi-symbol portfolio risk and performance
7. **Real-time Updates**: WebSocket connections for live price updates
8. **Advanced Charting**: More chart types and technical analysis tools
9. **User Preferences**: Save chart preferences, default symbols
10. **Export Features**: Export backtest results, watchlists to CSV/PDF

---

## FILE STRUCTURE SUMMARY

```
Finance/
├── backend/
│   ├── app/
│   │   ├── api/              # API route handlers
│   │   ├── auth/             # Auth dependencies
│   │   ├── db/               # Database setup
│   │   ├── models/           # SQLAlchemy models
│   │   ├── services/         # Business logic services
│   │   ├── tasks/            # Celery tasks
│   │   ├── config.py         # Configuration
│   │   └── main.py           # FastAPI app entry
│   ├── scripts/              # Data sync scripts
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── app/              # Next.js pages
│   │   ├── components/       # React components
│   │   ├── contexts/         # React contexts
│   │   ├── hooks/            # Custom hooks
│   │   └── lib/              # Utilities (api, auth, store)
│   └── package.json          # Node dependencies
├── docs/                     # Documentation
└── docker-compose.yml        # Local development setup
```

---

## API RATE LIMITS & CONSIDERATIONS

- **Alpha Vantage**: 5 API calls per minute, 500 per day (free tier)
- **Rate Limiting**: Implemented in frontend with `refetchInterval` and `staleTime`
- **Fallback Strategy**: Use database cached data when API limits reached
- **Mock Data**: Available for all endpoints for development/testing

---

## SECURITY NOTES

1. **JWT Secret**: Should be changed in production (currently default)
2. **Password Hashing**: Uses bcrypt (secure)
3. **SQL Injection**: Prevented by SQLAlchemy ORM
4. **CORS**: Configured for specific origins
5. **API Keys**: Stored in environment variables (never commit)
6. **Authentication**: Required for watchlist and chat history endpoints

---

## TESTING & DEVELOPMENT

### Local Setup
1. Start PostgreSQL and Redis: `docker-compose up -d`
2. Install backend dependencies: `pip install -r requirements.txt`
3. Run database migrations: `python scripts/init_database.py`
4. Start backend: `uvicorn app.main:app --reload`
5. Install frontend dependencies: `npm install`
6. Start frontend: `npm run dev`

### Data Sync
- Sync symbols: `POST /api/v1/symbols/{symbol}/sync`
- Sync prices: `POST /api/v1/prices/{symbol}/sync`
- Sync news: `POST /api/v1/news/{symbol}/sync`
- Sync filings: `POST /api/v1/filings/{symbol}/sync`

---

## NOTES FOR AI ASSISTANTS (Gemini, etc.)

This is a **complete specification** of the AI Trading & Research Copilot project. Every function, API endpoint, database table, service method, and frontend component is documented here. Use this as your single source of truth for:

1. Understanding the codebase architecture
2. Adding new features
3. Debugging issues
4. Refactoring code
5. Writing tests
6. Creating documentation

**Key Points**:
- Backend uses FastAPI with SQLAlchemy ORM
- Frontend uses Next.js 14 with React Query for state
- Database is PostgreSQL with pgvector extension
- AI/RAG uses Claude (Anthropic) via LangChain
- All API endpoints are RESTful with JSON responses
- Authentication uses JWT tokens
- Mock data available for testing all features

**When extending the project**:
- Follow existing patterns (service layer for business logic, API routes for endpoints)
- Use TypeScript interfaces in frontend matching backend Pydantic models
- Update this specification when adding new features
- Maintain backward compatibility where possible

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Project Status**: Phase 1-4 Complete, Phase 5 Ongoing
