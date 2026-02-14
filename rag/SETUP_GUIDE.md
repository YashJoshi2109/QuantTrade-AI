# QuantTrade AI - RAG System Setup Guide

## 🚀 Quick Start

### Prerequisites
- Python 3.10 or higher
- pip
- API Keys:
  - Anthropic API key (for Claude)
  - OpenAI API key (for embeddings)
  - Alpha Vantage API key (for stock data)
  - Financial Modeling Prep API key (optional)

### Step 1: Install Dependencies

```bash
cd rag/
pip install -r requirements.txt
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
ALPHA_VANTAGE_API_KEY=xxxxx
FMP_API_KEY=xxxxx
```

### Step 3: Initialize Vector Database

```python
python -c "from rag_engine import VectorDB, RAGConfig; VectorDB(RAGConfig())"
```

This creates the ChromaDB collections.

### Step 4: Ingest Sample Data

```python
python data_ingestion.py
```

This will ingest data for popular stocks (AAPL, MSFT, GOOGL, etc.)

**Note:** Alpha Vantage free tier has rate limits (5 calls/minute, 500/day).
The script includes delays to handle this.

### Step 5: Start API Server

```bash
python api_server.py
```

Server will start at `http://localhost:8000`

API Documentation available at: `http://localhost:8000/docs`

## 📋 API Endpoints

### 1. Stock Analysis

**Fundamental Analysis:**
```bash
curl -X POST "http://localhost:8000/api/analyze/fundamental?symbol=AAPL"
```

**Sentiment Analysis:**
```bash
curl -X POST "http://localhost:8000/api/analyze/sentiment?symbol=AAPL"
```

**Technical Analysis:**
```bash
curl -X POST "http://localhost:8000/api/analyze/technical?symbol=AAPL"
```

**Holistic Analysis:**
```bash
curl -X POST "http://localhost:8000/api/analyze/holistic?symbol=AAPL"
```

### 2. Chat Interface

```bash
curl -X POST "http://localhost:8000/api/chat/stock" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "message": "Should I invest in this stock?",
    "conversation_history": []
  }'
```

### 3. Stock Comparison

```bash
curl -X POST "http://localhost:8000/api/analyze/compare" \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["AAPL", "MSFT", "GOOGL"],
    "analysis_type": "holistic"
  }'
```

### 4. Data Ingestion

```bash
curl -X POST "http://localhost:8000/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["TSLA", "NVDA", "AMD"]
  }'
```

## 🔌 Frontend Integration

### React/Next.js Integration

Install dependencies in your frontend:
```bash
npm install @tanstack/react-query
```

Create API client:

```typescript
// lib/rag-api.ts
const RAG_API_URL = process.env.NEXT_PUBLIC_RAG_API_URL || 'http://localhost:8000'

export const analyzeStock = async (
  symbol: string,
  analysisType: 'fundamental' | 'sentiment' | 'technical' | 'holistic'
) => {
  const response = await fetch(`${RAG_API_URL}/api/analyze/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, analysis_type: analysisType, stream: false })
  })
  
  if (!response.ok) {
    throw new Error('Analysis failed')
  }
  
  return response.json()
}

export const chatWithStock = async (
  symbol: string,
  message: string,
  conversationHistory: Array<{ role: string; content: string }> = []
) => {
  const response = await fetch(`${RAG_API_URL}/api/chat/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      message,
      conversation_history: conversationHistory,
      stream: false
    })
  })
  
  if (!response.ok) {
    throw new Error('Chat failed')
  }
  
  return response.json()
}

// Streaming version
export async function* streamAnalysis(
  symbol: string,
  analysisType: string
) {
  const response = await fetch(`${RAG_API_URL}/api/analyze/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, analysis_type: analysisType, stream: true })
  })
  
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  
  while (true) {
    const { done, value } = await reader!.read()
    if (done) break
    
    const chunk = decoder.decode(value)
    const lines = chunk.split('\n')
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        yield data
      }
    }
  }
}
```

Use in components:

```typescript
// components/StockAnalysis.tsx
import { useQuery } from '@tanstack/react-query'
import { analyzeStock } from '@/lib/rag-api'

export function StockAnalysis({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analysis', symbol, 'holistic'],
    queryFn: () => analyzeStock(symbol, 'holistic')
  })
  
  if (isLoading) return <div>Analyzing {symbol}...</div>
  if (error) return <div>Error: {error.message}</div>
  
  return (
    <div className="prose">
      <h2>Analysis for {symbol}</h2>
      <div dangerouslySetInnerHTML={{ __html: data.result }} />
    </div>
  )
}
```

## 🔄 Data Update Schedule

### Recommended Update Frequency

1. **Fundamentals:** Quarterly (after earnings releases)
2. **News/Sentiment:** Daily
3. **Technical Data:** Daily or real-time

### Automated Updates

Create a cron job for daily updates:

```bash
# crontab -e
# Run at 6 AM daily
0 6 * * * cd /path/to/rag && python data_ingestion.py
```

Or use Python scheduler:

```python
# scheduler.py
import schedule
import time
from data_ingestion import DataIngestionPipeline
from rag_engine import VectorDB, RAGConfig

def update_stocks():
    config = RAGConfig()
    vector_db = VectorDB(config)
    pipeline = DataIngestionPipeline(vector_db=vector_db)
    
    # Update top stocks
    stocks = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]
    pipeline.ingest_multiple_stocks(stocks)

# Schedule daily at 6 AM
schedule.every().day.at("06:00").do(update_stocks)

while True:
    schedule.run_pending()
    time.sleep(60)
```

## 📊 Performance Optimization

### 1. Caching with Redis

```python
# rag_engine.py - Add Redis caching
import redis

class RAGEngine:
    def __init__(self, config: RAGConfig):
        # ... existing code ...
        self.redis_client = redis.Redis.from_url(
            os.getenv('REDIS_URL', 'redis://localhost:6379')
        )
    
    def analyze(self, symbol, analysis_type, **kwargs):
        # Check cache
        cache_key = f"analysis:{symbol}:{analysis_type}"
        cached = self.redis_client.get(cache_key)
        
        if cached:
            return cached.decode('utf-8')
        
        # Generate analysis
        result = # ... existing analysis code ...
        
        # Cache for 1 hour
        self.redis_client.setex(cache_key, 3600, result)
        
        return result
```

### 2. Batch Embedding Generation

```python
# Process multiple documents at once
def embed_batch(texts: List[str]) -> List[List[float]]:
    # Use OpenAI batch endpoint
    response = openai.Embedding.create(
        model="text-embedding-3-large",
        input=texts
    )
    return [item['embedding'] for item in response['data']]
```

### 3. Query Optimization

```python
# Use hybrid search (keyword + vector)
def hybrid_search(query: str, symbol: str):
    # Keyword filter
    keyword_results = collection.get(
        where={"symbol": symbol, "content": {"$contains": query}}
    )
    
    # Vector search
    vector_results = collection.query(
        query_texts=[query],
        where={"symbol": symbol}
    )
    
    # Combine and deduplicate
    return merge_results(keyword_results, vector_results)
```

## 🔒 Security Best Practices

1. **API Key Management:**
   - Never commit `.env` file
   - Rotate keys regularly
   - Use separate keys for dev/prod

2. **Rate Limiting:**
   - Implement rate limits on API endpoints
   - Use API key authentication for production

3. **Input Validation:**
   - Validate stock symbols
   - Sanitize user inputs
   - Limit query length

4. **CORS Configuration:**
   - Restrict origins in production
   - Use environment-specific settings

## 📈 Monitoring

### Key Metrics to Track

1. **Query Performance:**
   - Average response time
   - 95th percentile latency
   - Cache hit rate

2. **Data Freshness:**
   - Last update timestamp per stock
   - Number of documents per collection

3. **LLM Usage:**
   - Number of API calls
   - Token usage
   - Cost tracking

### Logging Setup

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('rag_system.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger('QuantTrade-RAG')
```

## 🐛 Troubleshooting

### Common Issues

**Issue: ChromaDB persistence error**
```bash
# Solution: Clear and reinitialize
rm -rf ./chroma_db
python -c "from rag_engine import VectorDB, RAGConfig; VectorDB(RAGConfig())"
```

**Issue: Rate limit errors from Alpha Vantage**
```python
# Solution: Increase delays in data_ingestion.py
time.sleep(15)  # Increase from 12 to 15 seconds
```

**Issue: Embedding dimension mismatch**
```python
# Solution: Ensure consistent embedding model
# Check EMBEDDING_MODEL in RAGConfig matches OpenAI model
```

**Issue: Out of memory during embedding**
```python
# Solution: Process in smaller batches
batch_size = 10  # Reduce from 50
```

## 📚 Additional Resources

- [Anthropic Documentation](https://docs.anthropic.com)
- [ChromaDB Documentation](https://docs.trychroma.com)
- [Alpha Vantage API](https://www.alphavantage.co/documentation/)
- [FastAPI Documentation](https://fastapi.tiangolo.com)

## 🎯 Next Steps

1. Add more data sources (SEC filings, social media)
2. Implement advanced technical indicators
3. Add backtesting capabilities
4. Build portfolio analysis features
5. Create mobile app integration
6. Add real-time data streaming
7. Implement user authentication
8. Add custom alert systems

---

**Support:** For issues or questions, refer to the main project documentation.
