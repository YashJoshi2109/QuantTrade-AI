"""
QuantTrade AI - Data Ingestion Pipeline
Fetches and processes stock data from various sources
"""

import os
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass
import json
import time
from rag_engine import StockDocument, VectorDB, RAGConfig

# ============================================================================
# DATA SOURCE CLIENTS
# ============================================================================

class AlphaVantageClient:
    """Client for Alpha Vantage API."""
    
    BASE_URL = "https://www.alphavantage.co/query"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
    
    def _request(self, function: str, symbol: str, **kwargs) -> Dict:
        """Make API request."""
        params = {
            "function": function,
            "symbol": symbol,
            "apikey": self.api_key,
            **kwargs
        }
        response = requests.get(self.BASE_URL, params=params)
        return response.json()
    
    def get_company_overview(self, symbol: str) -> Dict:
        """Get company fundamentals."""
        return self._request("OVERVIEW", symbol)
    
    def get_income_statement(self, symbol: str) -> Dict:
        """Get income statement."""
        return self._request("INCOME_STATEMENT", symbol)
    
    def get_balance_sheet(self, symbol: str) -> Dict:
        """Get balance sheet."""
        return self._request("BALANCE_SHEET", symbol)
    
    def get_cash_flow(self, symbol: str) -> Dict:
        """Get cash flow statement."""
        return self._request("CASH_FLOW", symbol)
    
    def get_news_sentiment(self, symbol: str) -> Dict:
        """Get news and sentiment."""
        return self._request("NEWS_SENTIMENT", symbol, tickers=symbol)

class FinancialModelingPrepClient:
    """Client for Financial Modeling Prep API."""
    
    BASE_URL = "https://financialmodelingprep.com/api/v3"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
    
    def _request(self, endpoint: str, **kwargs) -> Any:
        """Make API request."""
        params = {"apikey": self.api_key, **kwargs}
        url = f"{self.BASE_URL}/{endpoint}"
        response = requests.get(url, params=params)
        return response.json()
    
    def get_profile(self, symbol: str) -> List[Dict]:
        """Get company profile."""
        return self._request(f"profile/{symbol}")
    
    def get_financial_ratios(self, symbol: str) -> List[Dict]:
        """Get financial ratios."""
        return self._request(f"ratios/{symbol}")
    
    def get_key_metrics(self, symbol: str) -> List[Dict]:
        """Get key metrics."""
        return self._request(f"key-metrics/{symbol}")
    
    def get_stock_news(self, symbol: str, limit: int = 50) -> List[Dict]:
        """Get stock news."""
        return self._request(f"stock_news", tickers=symbol, limit=limit)
    
    def get_analyst_estimates(self, symbol: str) -> List[Dict]:
        """Get analyst estimates."""
        return self._request(f"analyst-estimates/{symbol}")

# ============================================================================
# DATA PROCESSORS
# ============================================================================

class FundamentalDataProcessor:
    """Process fundamental data into documents."""
    
    @staticmethod
    def process_company_overview(symbol: str, data: Dict) -> StockDocument:
        """Process company overview into document."""
        content = f"""
Company: {data.get('Name', symbol)}
Sector: {data.get('Sector', 'N/A')}
Industry: {data.get('Industry', 'N/A')}

Financial Metrics:
- Market Cap: ${data.get('MarketCapitalization', 'N/A')}
- P/E Ratio: {data.get('PERatio', 'N/A')}
- P/B Ratio: {data.get('PriceToBookRatio', 'N/A')}
- Dividend Yield: {data.get('DividendYield', 'N/A')}
- EPS: {data.get('EPS', 'N/A')}
- ROE: {data.get('ReturnOnEquityTTM', 'N/A')}
- ROA: {data.get('ReturnOnAssetsTTM', 'N/A')}
- Profit Margin: {data.get('ProfitMargin', 'N/A')}

Valuation:
- 52 Week High: ${data.get('52WeekHigh', 'N/A')}
- 52 Week Low: ${data.get('52WeekLow', 'N/A')}
- Beta: {data.get('Beta', 'N/A')}

Description:
{data.get('Description', 'No description available')}
        """.strip()
        
        return StockDocument(
            id=f"{symbol}_overview_{datetime.now().strftime('%Y%m%d')}",
            symbol=symbol,
            doc_type="fundamental",
            content=content,
            metadata={
                "source": "Alpha Vantage",
                "data_type": "company_overview",
                **data
            },
            timestamp=datetime.now()
        )
    
    @staticmethod
    def process_income_statement(symbol: str, data: Dict) -> List[StockDocument]:
        """Process income statements into documents."""
        documents = []
        
        reports = data.get('annualReports', []) + data.get('quarterlyReports', [])
        
        for report in reports[:8]:  # Last 8 quarters/years
            fiscal_date = report.get('fiscalDateEnding', 'Unknown')
            
            content = f"""
Income Statement for {symbol} - {fiscal_date}

Revenue: ${report.get('totalRevenue', 'N/A')}
Cost of Revenue: ${report.get('costOfRevenue', 'N/A')}
Gross Profit: ${report.get('grossProfit', 'N/A')}

Operating Income: ${report.get('operatingIncome', 'N/A')}
Net Income: ${report.get('netIncome', 'N/A')}
EPS: ${report.get('eps', 'N/A')}

Expenses:
- Operating Expenses: ${report.get('operatingExpenses', 'N/A')}
- R&D: ${report.get('researchAndDevelopment', 'N/A')}
- SG&A: ${report.get('sellingGeneralAndAdministrative', 'N/A')}
            """.strip()
            
            doc = StockDocument(
                id=f"{symbol}_income_{fiscal_date}",
                symbol=symbol,
                doc_type="fundamental",
                content=content,
                metadata={
                    "source": "Alpha Vantage",
                    "data_type": "income_statement",
                    "fiscal_date": fiscal_date,
                    **report
                },
                timestamp=datetime.fromisoformat(fiscal_date) if fiscal_date != 'Unknown' else datetime.now()
            )
            documents.append(doc)
        
        return documents

class NewsDataProcessor:
    """Process news data into documents."""
    
    @staticmethod
    def process_news_article(symbol: str, article: Dict) -> StockDocument:
        """Process a single news article."""
        title = article.get('title', '')
        summary = article.get('summary', '')
        url = article.get('url', '')
        published_date = article.get('time_published', datetime.now().isoformat())
        source = article.get('source', 'Unknown')
        
        # Calculate sentiment score
        sentiment_score = article.get('overall_sentiment_score', 0.0)
        sentiment_label = article.get('overall_sentiment_label', 'Neutral')
        
        content = f"""
Title: {title}

Summary: {summary}

Sentiment: {sentiment_label} (Score: {sentiment_score})

Source: {source}
Published: {published_date}
URL: {url}
        """.strip()
        
        return StockDocument(
            id=f"{symbol}_news_{published_date}_{hash(title)}",
            symbol=symbol,
            doc_type="news",
            content=content,
            metadata={
                "title": title,
                "url": url,
                "source": source,
                "sentiment_score": sentiment_score,
                "sentiment_label": sentiment_label,
                "published_date": published_date
            },
            timestamp=datetime.fromisoformat(published_date.replace('Z', '+00:00').replace('T', ' ')[:19])
        )
    
    @staticmethod
    def process_news_batch(symbol: str, news_data: Dict) -> List[StockDocument]:
        """Process batch of news articles."""
        documents = []
        
        feed = news_data.get('feed', [])
        for article in feed:
            doc = NewsDataProcessor.process_news_article(symbol, article)
            documents.append(doc)
        
        return documents

class TechnicalDataProcessor:
    """Process technical analysis data."""
    
    @staticmethod
    def process_price_data(symbol: str, prices: List[Dict]) -> StockDocument:
        """Process price data and technical indicators."""
        # Calculate basic indicators
        latest = prices[0] if prices else {}
        
        # Simple moving averages
        sma_20 = sum([p.get('close', 0) for p in prices[:20]]) / 20 if len(prices) >= 20 else 0
        sma_50 = sum([p.get('close', 0) for p in prices[:50]]) / 50 if len(prices) >= 50 else 0
        sma_200 = sum([p.get('close', 0) for p in prices[:200]]) / 200 if len(prices) >= 200 else 0
        
        # RSI calculation (simplified)
        rsi = 50  # Placeholder - would need proper calculation
        
        content = f"""
Technical Analysis for {symbol}

Current Price: ${latest.get('close', 'N/A')}
Volume: {latest.get('volume', 'N/A')}

Moving Averages:
- SMA 20: ${sma_20:.2f}
- SMA 50: ${sma_50:.2f}
- SMA 200: ${sma_200:.2f}

Technical Indicators:
- RSI: {rsi}
- MACD: N/A (calculate from price data)

Price Trend:
- 1 Week: {((latest.get('close', 0) / prices[5].get('close', 1) - 1) * 100 if len(prices) > 5 else 0):.2f}%
- 1 Month: {((latest.get('close', 0) / prices[20].get('close', 1) - 1) * 100 if len(prices) > 20 else 0):.2f}%
- 3 Months: {((latest.get('close', 0) / prices[60].get('close', 1) - 1) * 100 if len(prices) > 60 else 0):.2f}%
        """.strip()
        
        return StockDocument(
            id=f"{symbol}_technical_{datetime.now().strftime('%Y%m%d')}",
            symbol=symbol,
            doc_type="technical",
            content=content,
            metadata={
                "source": "Price Data",
                "sma_20": sma_20,
                "sma_50": sma_50,
                "sma_200": sma_200,
                "rsi": rsi
            },
            timestamp=datetime.now()
        )

# ============================================================================
# INGESTION PIPELINE
# ============================================================================

class DataIngestionPipeline:
    """Main data ingestion pipeline."""
    
    def __init__(
        self,
        vector_db: VectorDB,
        alpha_vantage_key: Optional[str] = None,
        fmp_key: Optional[str] = None
    ):
        self.vector_db = vector_db
        
        if alpha_vantage_key:
            self.av_client = AlphaVantageClient(alpha_vantage_key)
        else:
            self.av_client = None
        
        if fmp_key:
            self.fmp_client = FinancialModelingPrepClient(fmp_key)
        else:
            self.fmp_client = None
    
    def ingest_stock(self, symbol: str):
        """Ingest all data for a stock."""
        print(f"Ingesting data for {symbol}...")
        
        # Ingest fundamentals
        if self.av_client:
            try:
                self.ingest_fundamentals(symbol)
                time.sleep(12)  # Rate limiting
            except Exception as e:
                print(f"Error ingesting fundamentals: {e}")
        
        # Ingest news
        if self.av_client:
            try:
                self.ingest_news(symbol)
                time.sleep(12)
            except Exception as e:
                print(f"Error ingesting news: {e}")
        
        print(f"Completed ingestion for {symbol}")
    
    def ingest_fundamentals(self, symbol: str):
        """Ingest fundamental data."""
        # Company overview
        overview = self.av_client.get_company_overview(symbol)
        if overview:
            doc = FundamentalDataProcessor.process_company_overview(symbol, overview)
            self.vector_db.add_document("fundamentals", doc)
            print(f"  Added company overview for {symbol}")
        
        # Income statement
        income = self.av_client.get_income_statement(symbol)
        if income:
            docs = FundamentalDataProcessor.process_income_statement(symbol, income)
            self.vector_db.add_documents_batch("fundamentals", docs)
            print(f"  Added {len(docs)} income statements for {symbol}")
    
    def ingest_news(self, symbol: str):
        """Ingest news data."""
        news_data = self.av_client.get_news_sentiment(symbol)
        if news_data:
            docs = NewsDataProcessor.process_news_batch(symbol, news_data)
            self.vector_db.add_documents_batch("news", docs)
            print(f"  Added {len(docs)} news articles for {symbol}")
    
    def ingest_multiple_stocks(self, symbols: List[str]):
        """Ingest data for multiple stocks."""
        for symbol in symbols:
            self.ingest_stock(symbol)
            time.sleep(15)  # Rate limiting between stocks

# ============================================================================
# EXAMPLE USAGE
# ============================================================================

if __name__ == "__main__":
    # Initialize components
    config = RAGConfig()
    vector_db = VectorDB(config)
    
    # Initialize pipeline
    pipeline = DataIngestionPipeline(
        vector_db=vector_db,
        alpha_vantage_key=os.getenv("ALPHA_VANTAGE_API_KEY"),
        fmp_key=os.getenv("FMP_API_KEY")
    )
    
    # Ingest data for popular stocks
    popular_stocks = [
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
        "TSLA", "META", "BRK.B", "JPM", "V"
    ]
    
    pipeline.ingest_multiple_stocks(popular_stocks)
