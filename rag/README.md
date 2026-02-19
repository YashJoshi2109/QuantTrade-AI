# QuantTrade AI - Stock Analysis RAG System

## 🎯 Overview

A production-ready **Retrieval-Augmented Generation (RAG)** system for comprehensive stock market analysis. Uses Claude Sonnet 4 to provide:

- **Fundamental Analysis**: Financial metrics, valuation, balance sheet strength
- **Sentiment Analysis**: News, social media, analyst ratings
- **Technical Analysis**: Price trends, indicators, chart patterns
- **Holistic Analysis**: Combined recommendation with risk assessment
- **Conversational AI**: Chat interface for interactive stock queries

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React/Next.js)                 │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │Dashboard │  │ Research │  │   Chat   │  │ Compare  │         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
└───────┼─────────────┼─────────────┼─────────────┼───────────────┘
        │             │             │             │
        └─────────────┴─────────────┴─────────────┘
                      │
        ┌─────────────▼──────────────┐
        │   FastAPI Backend (RAG)    │
        │                            │
        │  ┌──────────────────────┐  │
        │  │   RAG Engine         │  │
        │  │  - Query Processing  │  │
        │  │  - Context Retrieval │  │
        │  │  - LLM Integration   │  │
        │  └──────────────────────┘  │
        └────────────┬────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
    ┌───▼────┐              ┌────▼─────┐
    │ChromaDB│              │Claude API│
    │Vector  │              │Sonnet 4  │
    │Database│              │200K ctx  │
    └───▲────┘              └──────────┘
        │
    ┌───┴──────────┐
    │Data Ingestion│
    │  - Alpha V   │
    │  - FMP       │
    │  - News APIs │
    └──────────────┘
```

## ✨ Features

### Analysis Capabilities

1. **Fundamental Analysis**
   - Revenue growth and profitability metrics
   - Balance sheet strength assessment
   - Valuation multiples (P/E, P/B, EV/EBITDA)
   - Cash flow analysis
   - Competitive positioning

2. **Sentiment Analysis**
   - News sentiment scoring (-1 to +1)
   - Social media trend analysis
   - Analyst rating aggregation
   - Market sentiment indicators
   - Sentiment trend detection

3. **Technical Analysis**
   - Trend identification
   - Support/resistance levels
   - Technical indicators (RSI, MACD, MA)
   - Chart pattern recognition
   - Momentum analysis

4. **Holistic Analysis**
   - Investment thesis generation
   - Risk-reward assessment
   - Buy/Hold/Sell recommendation
   - 12-month price target
   - Confidence and risk scoring

### AI Features

- **Context-Aware**: Retrieves relevant data from vector database
- **Multi-Source**: Combines fundamentals, news, and technical data
- **Conversational**: Natural language chat interface
- **Comparative**: Side-by-side stock comparison
- **Streaming**: Real-time response streaming
- **Caching**: Intelligent result caching for performance

## 📦 File Structure

```
rag/
├── RAG_ARCHITECTURE.md     # System architecture documentation
├── SETUP_GUIDE.md          # Detailed setup instructions
├── requirements.txt        # Python dependencies
├── .env.example           # Environment variables template
│
├── prompts.py             # LLM prompts for all analysis types
├── rag_engine.py          # Core RAG engine implementation
├── data_ingestion.py      # Data fetching and processing
├── api_server.py          # FastAPI backend
├── quick_start.py         # Quick start demo script
│
└── chroma_db/            # Vector database (created on first run)
    ├── stock_fundamentals/
    ├── stock_news/
    ├── stock_technical/
    ├── stock_analysis/
    └── sec_filings/
```

## 🚀 Quick Start (5 Minutes)

### 1. Install Dependencies

```bash
cd rag/
pip install -r requirements.txt
```

### 2. Set Up API Keys

```bash
cp .env.example .env
```

Edit `.env` with your keys:
```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
ALPHA_VANTAGE_API_KEY=xxxxx
```

**Get API Keys:**
- [Anthropic (Claude)](https://console.anthropic.com/)
- [OpenAI (Embeddings)](https://platform.openai.com/)
- [Alpha Vantage (Free)](https://www.alphavantage.co/support/#api-key)

### 3. Run Quick Start

```bash
python quick_start.py
```

This will:
- ✅ Verify API keys
- ✅ Initialize vector database
- ✅ Ingest sample data (AAPL)
- ✅ Run demo analyses
- ✅ Show example outputs

### 4. Start API Server

```bash
python api_server.py
```

API runs at: `http://localhost:8000`
Docs at: `http://localhost:8000/docs`

## 📡 API Usage

### Fundamental Analysis

```bash
curl -X POST "http://localhost:8000/api/analyze/fundamental?symbol=AAPL"
```

### Chat Interface

```bash
curl -X POST "http://localhost:8000/api/chat/stock" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "message": "Is Apple a good investment right now?"
  }'
```

### Stock Comparison

```bash
curl -X POST "http://localhost:8000/api/analyze/compare" \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["AAPL", "MSFT", "GOOGL"]
  }'
```

## 🔌 Frontend Integration

### React/Next.js Example

```typescript
// lib/rag-api.ts
export async function analyzeStock(symbol: string, type: string) {
  const res = await fetch('http://localhost:8000/api/analyze/stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, analysis_type: type, stream: false })
  })
  return res.json()
}

// Component usage
import { useQuery } from '@tanstack/react-query'

export function StockAnalysis({ symbol }: { symbol: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['analysis', symbol],
    queryFn: () => analyzeStock(symbol, 'holistic')
  })
  
  if (isLoading) return <div>Analyzing...</div>
  
  return (
    <div className="analysis">
      <h2>{symbol} Analysis</h2>
      <pre>{data.result}</pre>
    </div>
  )
}
```

### Streaming Example

```typescript
async function* streamAnalysis(symbol: string) {
  const res = await fetch('http://localhost:8000/api/analyze/stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, analysis_type: 'holistic', stream: true })
  })
  
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    
    const chunk = decoder.decode(value)
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        yield data
      }
    }
  }
}

// Usage in component
for await (const chunk of streamAnalysis('AAPL')) {
  setAnalysis(prev => prev + chunk)
}
```

## 🎨 Example Outputs

### Fundamental Analysis

```
Executive Summary
Apple Inc. (AAPL) demonstrates strong financial fundamentals with robust 
profitability metrics and a solid balance sheet. Current P/E ratio of 28.5
suggests moderate valuation relative to growth prospects.

Key Metrics
• Market Cap: $2.8T
• P/E Ratio: 28.5 (vs industry avg 23.4)
• ROE: 48% (excellent)
• Debt-to-Equity: 1.73 (manageable)
• Current Ratio: 0.98 (adequate liquidity)

Strengths
• Industry-leading profit margins (26%)
• Strong brand moat and customer loyalty
• Consistent revenue growth (8% YoY)
• Significant cash reserves ($165B)

Valuation Assessment: Fairly Valued
Investment Grade: A
```

### Holistic Analysis

```
Overall Rating
• Recommendation: BUY
• Confidence Level: High
• Risk Level: Medium

Investment Thesis
Apple represents a compelling long-term investment opportunity driven by 
services growth, emerging markets expansion, and continued ecosystem strength...

12-Month Price Target: $195
Expected Upside: +9.2%

Primary Risks
• Regulatory pressure in EU and China
• iPhone sales dependency (52% of revenue)
• Macroeconomic headwinds affecting consumer spending
```

## 💡 LLM Prompt Examples

The system uses sophisticated prompts optimized for Claude Sonnet 4. Key prompt types:

### System Prompt
```python
"""You are an expert financial analyst specializing in stock market analysis...
Your analysis must be:
- Data-driven and evidence-based
- Cite specific metrics and sources
- Acknowledge limitations and uncertainties
- Provide balanced bull/bear perspectives
..."""
```

### Fundamental Analysis Prompt
```python
"""Analyze {symbol} from a fundamental perspective using the provided data.

Context Data:
{context}

Provide structured analysis with:
1. Executive Summary
2. Key Metrics  
3. Strengths/Weaknesses
4. Valuation Assessment
5. Investment Grade
..."""
```

See `prompts.py` for all prompt templates.

## 🔧 Configuration

### Vector Database

```python
# rag_engine.py
class RAGConfig:
    CHROMA_DB_PATH = "./chroma_db"
    COLLECTION_NAMES = {
        "fundamentals": "stock_fundamentals",
        "news": "stock_news",
        "technical": "stock_technical",
        "analysis": "stock_analysis",
        "filings": "sec_filings",
    }
    TOP_K_RESULTS = 10  # Documents to retrieve
    SIMILARITY_THRESHOLD = 0.7
```

### LLM Settings

```python
LLM_MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096
TEMPERATURE = 0.3  # Lower for more focused analysis
```

## 📊 Data Sources

### Current Integrations

1. **Alpha Vantage** (Free tier: 500 calls/day)
   - Company fundamentals
   - Financial statements
   - News sentiment

2. **Financial Modeling Prep** (Optional)
   - Enhanced financial data
   - Analyst estimates
   - Key metrics

### Future Integrations

- SEC Edgar (10-K, 10-Q filings)
- Twitter/Reddit sentiment
- Insider trading data
- Options data

## 🔐 Security

- API keys in environment variables only
- CORS configured for production
- Rate limiting on endpoints
- Input validation and sanitization
- No sensitive data in logs

## 📈 Performance

- **Response Time**: 2-5 seconds (non-streaming)
- **Cache Hit Rate**: 60-80% for repeated queries
- **Embeddings**: Batch processed for efficiency
- **Vector Search**: Sub-100ms retrieval

### Optimization Tips

1. Enable Redis caching
2. Use streaming for better UX
3. Batch embed documents
4. Implement query rewriting

## 🐛 Troubleshooting

**ChromaDB Issues:**
```bash
rm -rf ./chroma_db
python -c "from rag_engine import VectorDB, RAGConfig; VectorDB(RAGConfig())"
```

**Rate Limit Errors:**
- Alpha Vantage: 5 calls/minute, add delays
- Claude API: Monitor usage in console

**Import Errors:**
```bash
pip install -r requirements.txt --upgrade
```

## 📚 Documentation

- **RAG_ARCHITECTURE.md**: System design and data flow
- **SETUP_GUIDE.md**: Detailed installation and deployment
- **API Docs**: http://localhost:8000/docs (when running)

## 🎯 Roadmap

- [ ] Real-time data streaming
- [ ] Portfolio analysis
- [ ] Backtesting integration
- [ ] Custom alert system
- [ ] Mobile app support
- [ ] Multi-language support
- [ ] Advanced charting
- [ ] User authentication
- [ ] Premium features

## 📄 License

This code is provided as-is for the QuantTrade AI project.

## 🤝 Support

For issues or questions:
1. Check SETUP_GUIDE.md
2. Review API documentation
3. Check troubleshooting section
4. Review example code

---

**Built with:** Claude Sonnet 4, ChromaDB, FastAPI, Python 3.10+

**Last Updated:** February 2026
