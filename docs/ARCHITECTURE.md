# Architecture Documentation

## System Overview

The AI Trading & Research Copilot is built as a modern web application with a clear separation between frontend, backend, and data layers.

## Technology Stack

### Backend
- **Framework**: FastAPI (Python)
- **Database**: PostgreSQL (relational data) + ChromaDB (vector embeddings)
- **Data Sources**: yfinance, SEC EDGAR API, News APIs
- **AI/ML**: OpenAI API, LangChain, Sentence Transformers

### Frontend
- **Framework**: Next.js 14 (React)
- **Charting**: TradingView Lightweight Charts
- **Styling**: Tailwind CSS
- **Language**: TypeScript

## Architecture Layers

### 1. Data Ingestion Layer
- Scheduled ETL jobs for market data
- News and filings ingestion pipelines
- Data validation and cleaning

### 2. Storage Layer
- **PostgreSQL**: OHLCV data, symbols, watchlists, user data
- **ChromaDB**: Vector embeddings for RAG
- **Object Storage**: Raw filings and documents (future)

### 3. API Layer
- RESTful API endpoints
- Authentication (future)
- Rate limiting and caching

### 4. Business Logic Layer
- Technical indicators computation
- Risk scoring models
- Backtest engine
- Sentiment analysis

### 5. AI/ML Layer
- RAG pipeline for document retrieval
- LLM agent with tool calling
- Embedding generation
- Context construction

### 6. Frontend Layer
- React components
- Chart visualization
- Chat interface
- Dashboard and portfolio views

## Data Flow

### Market Data Flow
```
External API (yfinance) → DataFetcher Service → PostgreSQL → API Endpoint → Frontend
```

### RAG Flow (Phase 2)
```
Documents → Chunking → Embedding → Vector DB → Retrieval → LLM → Response
```

### Chat Flow (Phase 2)
```
User Message → API → RAG Retrieval → Context Construction → LLM → Response + Citations
```

## Database Schema

### Symbols Table
- id, symbol, name, sector, industry, market_cap

### Price Bars Table
- id, symbol_id, timestamp, open, high, low, close, volume

### Watchlists Table
- id, user_id, symbol_id, created_at

## API Endpoints

### Phase 1
- `GET /api/v1/symbols` - List symbols
- `GET /api/v1/symbols/{symbol}` - Get symbol details
- `POST /api/v1/symbols/{symbol}/sync` - Sync symbol data
- `GET /api/v1/prices/{symbol}` - Get price bars
- `POST /api/v1/prices/{symbol}/sync` - Sync price data
- `GET /api/v1/indicators/{symbol}` - Get technical indicators

### Phase 2 (Planned)
- `POST /api/v1/chat` - AI copilot chat
- `GET /api/v1/news/{symbol}` - Get news articles
- `GET /api/v1/filings/{symbol}` - Get SEC filings

### Phase 3 (Planned)
- `GET /api/v1/watchlist` - Get user watchlist
- `POST /api/v1/watchlist` - Add to watchlist
- `GET /api/v1/risk/{symbol}` - Get risk metrics
- `GET /api/v1/risk/portfolio` - Get portfolio risk

### Phase 4 (Planned)
- `POST /api/v1/backtest` - Run backtest
- `GET /api/v1/strategies` - List strategy templates

## Security Considerations

- API authentication (JWT tokens)
- Rate limiting
- Input validation
- SQL injection prevention (SQLAlchemy ORM)
- CORS configuration

## Scalability Considerations

- Database indexing on frequently queried columns
- Caching layer for price data (Redis - future)
- Async processing for data ingestion
- Horizontal scaling of API servers
- CDN for static assets

## Monitoring & Logging

- Request/response logging
- Error tracking
- Performance metrics
- Data freshness monitoring
- AI model performance evaluation
