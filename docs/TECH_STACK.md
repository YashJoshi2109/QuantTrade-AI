# Technology Stack

## Frontend Stack

### Core Framework
- **Next.js 14** - React framework with App Router
- **React 18** - UI library
- **TypeScript** - Type safety

### UI & Styling
- **Tailwind CSS** - Utility-first CSS framework
- **Design System** - Reusable component library
- **Dark Mode** - Built-in dark theme support

### Charts
- **TradingView Lightweight Charts** - Professional candlestick charts and indicators

### State Management
- **React Query (TanStack Query)** - Server state management, caching, and synchronization
- **Zustand** - Lightweight global state for UI state (selected symbol, active tab, etc.)

### HTTP Client
- **Axios** - HTTP requests to backend API

## Backend Stack

### Framework
- **FastAPI** - Modern Python web framework
- **Python 3.11+** - With type hints throughout
- **Pydantic** - Data validation and settings management

### Authentication
- **JWT (python-jose)** - Token-based authentication
- **Passlib** - Password hashing (bcrypt)

### Background Jobs
- **Celery** - Distributed task queue
- **Redis** - Message broker and result backend

### Database & Storage

#### Primary Database
- **PostgreSQL 15+** - Relational database
- **SQLAlchemy** - ORM
- **Alembic** - Database migrations
- **pgvector** - Vector extension for PostgreSQL (RAG)

#### Vector Storage Options
- **Option A**: pgvector extension (integrated with PostgreSQL)
- **Option B**: Qdrant (dedicated vector database)

#### Object Storage
- **boto3** - AWS S3-compatible storage
- **minio** - Local S3-compatible storage option
- **Local storage** - Fallback for development

## Data, ML, and RAG Stack

### Data Ingestion
- **yfinance** - Market data (historical OHLCV)
- **pandas** - Data manipulation
- **numpy** - Numerical computing

### Feature Engineering & Signals
- **ta** - Technical analysis library
- **pandas-ta** - Additional technical indicators
- **statsmodels** - Time series analysis and forecasting

### ML Models
- **scikit-learn** - Core ML algorithms
- **XGBoost** - Gradient boosting for risk scoring
- **LightGBM** - Alternative gradient boosting
- **SHAP** - Model explainability and feature importance

### LLM + RAG
- **LangChain** - RAG orchestration framework
- **OpenAI API** - Hosted LLM (GPT-4, GPT-3.5)
- **sentence-transformers** - Open-source embeddings (all-MiniLM-L6-v2)
- **Qdrant Client** - Vector database client (optional)

### Embeddings
- **Primary**: OpenAI embeddings (via LangChain)
- **Fallback**: sentence-transformers (local)

## Development Tools

### Code Quality
- **Type hints** - Python type annotations
- **ESLint** - JavaScript/TypeScript linting
- **Prettier** - Code formatting (optional)

### Infrastructure
- **Docker** - Containerization
- **Docker Compose** - Local development environment
- **Redis** - Caching and task queue

## Deployment Considerations

### Production Ready
- FastAPI with uvicorn workers
- PostgreSQL with connection pooling
- Redis for caching and Celery
- S3-compatible storage for files
- Environment-based configuration

### Scalability
- Horizontal scaling with multiple API instances
- Celery workers for background processing
- Vector database can scale independently
- CDN for static assets (future)

## Version Requirements

- Python: 3.11+
- Node.js: 18+
- PostgreSQL: 15+
- Redis: 7+

## Key Design Decisions

1. **pgvector vs Qdrant**: Start with pgvector for simplicity, can migrate to Qdrant for scale
2. **React Query**: Handles all server state, reduces boilerplate
3. **Zustand**: Minimal global state, avoids prop drilling
4. **Celery**: Standard Python async task solution
5. **LangChain**: Industry-standard RAG framework
6. **OpenAI + sentence-transformers**: Best of both worlds - reliability + flexibility
