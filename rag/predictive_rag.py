"""
QuantTrade AI - Advanced Predictive RAG System
Complete implementation with real-time data, ML predictions, and interactive analysis
"""

import os
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
from dataclasses import dataclass
import json

# ML/AI imports
import anthropic
from sklearn.preprocessing import MinMaxScaler
import torch
import torch.nn as nn

# Data sources
import requests
from websocket import create_connection
import yfinance as yf

# ============================================================================
# CONFIGURATION
# ============================================================================

class AdvancedRAGConfig:
    """Configuration for advanced predictive system"""
    
    # API Keys
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
    NEWS_API_KEY = os.getenv("NEWS_API_KEY")
    FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")
    
    # Model Settings
    PREDICTION_CONFIDENCE_THRESHOLD = 0.6
    UPDATE_FREQUENCY_SECONDS = 15  # Predictions update every 15s
    
    # Data Sources
    ENABLE_REALTIME_PRICES = True
    ENABLE_NEWS_STREAM = True
    ENABLE_SENTIMENT_ANALYSIS = True
    ENABLE_SEC_MONITORING = True
    ENABLE_OPTIONS_FLOW = True
    
    # Prediction Timeframes
    PREDICTION_HORIZONS = {
        "1_day": 1,
        "1_week": 7,
        "1_month": 30,
        "3_month": 90
    }

# ============================================================================
# DATA MODELS
# ============================================================================

@dataclass
class PricePrediction:
    """Stock price prediction with confidence"""
    timeframe: str
    predicted_price: float
    current_price: float
    confidence: float
    direction: str  # UP, DOWN, NEUTRAL
    probability_up: float
    range_low: float
    range_high: float
    expected_return: float

@dataclass
class MarketEvent:
    """Real-time market event"""
    event_type: str  # NEWS, FILING, TRADE, ANOMALY
    symbol: str
    timestamp: datetime
    description: str
    impact: str  # BULLISH, BEARISH, NEUTRAL
    confidence: float
    data: Dict[str, Any]

@dataclass
class StockAnalysis:
    """Comprehensive stock analysis"""
    symbol: str
    current_price: float
    predictions: List[PricePrediction]
    sentiment_score: float
    technical_score: float
    fundamental_score: float
    overall_recommendation: str  # STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL
    confidence: float
    catalysts: List[str]
    risks: List[str]
    recent_events: List[MarketEvent]
    chart_data: Dict[str, Any]

# ============================================================================
# ML PREDICTION MODELS
# ============================================================================

class LSTMPredictor(nn.Module):
    """
    LSTM model for stock price prediction
    """
    
    def __init__(self, input_size=50, hidden_size=128, num_layers=3):
        super(LSTMPredictor, self).__init__()
        
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        
        # LSTM layers
        self.lstm = nn.LSTM(
            input_size, 
            hidden_size, 
            num_layers, 
            batch_first=True,
            dropout=0.2
        )
        
        # Attention mechanism
        self.attention = nn.Linear(hidden_size, 1)
        
        # Output layers
        self.fc1 = nn.Linear(hidden_size, 64)
        self.fc2 = nn.Linear(64, 1)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.2)
    
    def forward(self, x):
        # LSTM
        lstm_out, _ = self.lstm(x)
        
        # Attention weights
        attention_weights = torch.softmax(
            self.attention(lstm_out).squeeze(-1), 
            dim=1
        )
        
        # Apply attention
        context = torch.sum(
            lstm_out * attention_weights.unsqueeze(-1), 
            dim=1
        )
        
        # Fully connected layers
        out = self.fc1(context)
        out = self.relu(out)
        out = self.dropout(out)
        out = self.fc2(out)
        
        return out

class StockPredictor:
    """
    Main prediction engine using ensemble of models
    """
    
    def __init__(self):
        self.lstm_model = LSTMPredictor()
        self.scaler = MinMaxScaler()
        
        # Load pre-trained weights (if available)
        self._load_models()
    
    def _load_models(self):
        """Load pre-trained model weights"""
        try:
            self.lstm_model.load_state_dict(
                torch.load('models/lstm_predictor.pth')
            )
            self.lstm_model.eval()
        except:
            print("No pre-trained model found. Using default initialization.")
    
    def prepare_features(self, symbol: str, lookback_days: int = 60) -> np.ndarray:
        """
        Prepare features for prediction
        """
        # Download historical data. We try a primary window and, if that
        # yields no rows (rate limiting / symbol issues), fall back to a
        # longer period.
        stock = yf.Ticker(symbol)
        df = stock.history(period=f"{lookback_days}d")
        if df is None or df.empty:
            # Fallback: try a longer period before giving up.
            df = stock.history(period="1y")
        if df is None or df.empty:
            raise ValueError(
                f"No price data available for {symbol} from yfinance; "
                "cannot generate predictive features."
            )
        
        # Technical indicators
        df['SMA_20'] = df['Close'].rolling(window=20).mean()
        df['SMA_50'] = df['Close'].rolling(window=50).mean()
        df['RSI'] = self._calculate_rsi(df['Close'])
        df['MACD'], df['Signal'] = self._calculate_macd(df['Close'])
        df['BB_upper'], df['BB_lower'] = self._calculate_bollinger(df['Close'])
        df['Volume_SMA'] = df['Volume'].rolling(window=20).mean()
        df['Price_Change'] = df['Close'].pct_change()
        df['Volume_Change'] = df['Volume'].pct_change()
        
        # Select features
        features = [
            'Close', 'Volume', 'SMA_20', 'SMA_50', 
            'RSI', 'MACD', 'Signal', 'BB_upper', 'BB_lower',
            'Volume_SMA', 'Price_Change', 'Volume_Change'
        ]
        
        # Drop NaN rows created by rolling windows
        df = df[features].dropna()
        if df.empty:
            raise ValueError(
                f"Insufficient cleaned feature rows for {symbol}; "
                "try increasing lookback_days or check data source."
            )
        
        # Normalize
        scaled_data = self.scaler.fit_transform(df.values)
        return scaled_data
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate Relative Strength Index"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    def _calculate_macd(self, prices: pd.Series) -> tuple:
        """Calculate MACD"""
        exp1 = prices.ewm(span=12, adjust=False).mean()
        exp2 = prices.ewm(span=26, adjust=False).mean()
        macd = exp1 - exp2
        signal = macd.ewm(span=9, adjust=False).mean()
        return macd, signal
    
    def _calculate_bollinger(self, prices: pd.Series, period: int = 20) -> tuple:
        """Calculate Bollinger Bands"""
        sma = prices.rolling(window=period).mean()
        std = prices.rolling(window=period).std()
        upper = sma + (std * 2)
        lower = sma - (std * 2)
        return upper, lower
    
    def predict(
        self, 
        symbol: str, 
        timeframe_days: int = 1
    ) -> PricePrediction:
        """
        Generate price prediction
        """
        # Prepare data
        features = self.prepare_features(symbol)
        
        # Get current price
        current_price = yf.Ticker(symbol).info.get('currentPrice', 0)
        
        # Reshape for LSTM [batch, sequence, features]
        X = torch.FloatTensor(features[-60:]).unsqueeze(0)
        
        # Generate predictions (ensemble approach)
        with torch.no_grad():
            # LSTM prediction
            lstm_pred = self.lstm_model(X).item()
            
            # Simple linear extrapolation (for ensemble)
            linear_pred = self._linear_forecast(features, timeframe_days)
            
            # Weighted average
            predicted_price = (lstm_pred * 0.6 + linear_pred * 0.4)
        
        # Scale back to actual price range
        predicted_price = current_price * (1 + predicted_price)
        
        # Calculate confidence based on model agreement
        model_agreement = 1 - abs(lstm_pred - linear_pred) / max(abs(lstm_pred), abs(linear_pred))
        confidence = min(0.95, max(0.3, model_agreement))
        
        # Calculate prediction range
        volatility = features[-30:, 0].std()
        range_low = predicted_price - (volatility * 2)
        range_high = predicted_price + (volatility * 2)
        
        # Determine direction
        expected_return = (predicted_price - current_price) / current_price
        if expected_return > 0.01:
            direction = "UP"
            probability_up = min(0.95, 0.5 + (expected_return * 5))
        elif expected_return < -0.01:
            direction = "DOWN"
            probability_up = max(0.05, 0.5 + (expected_return * 5))
        else:
            direction = "NEUTRAL"
            probability_up = 0.5
        
        return PricePrediction(
            timeframe=f"{timeframe_days}_day",
            predicted_price=predicted_price,
            current_price=current_price,
            confidence=confidence,
            direction=direction,
            probability_up=probability_up,
            range_low=range_low,
            range_high=range_high,
            expected_return=expected_return * 100
        )
    
    def _linear_forecast(self, features: np.ndarray, days: int) -> float:
        """Simple linear extrapolation"""
        recent_trend = (features[-1, 0] - features[-10, 0]) / 10
        return recent_trend * days

# ============================================================================
# REAL-TIME DATA AGGREGATION
# ============================================================================

class RealtimeDataAggregator:
    """
    Aggregate data from multiple sources in real-time
    """
    
    def __init__(self, config: AdvancedRAGConfig):
        self.config = config
        self.news_cache = {}
        self.events = []
    
    async def get_realtime_price(self, symbol: str) -> float:
        """Get real-time price from Polygon, Finnhub, or Yahoo Finance."""
        try:
            # 1) Polygon tick-by-tick prices when available
            if self.config.POLYGON_API_KEY:
                url = f"https://api.polygon.io/v2/last/trade/{symbol}"
                params = {"apiKey": self.config.POLYGON_API_KEY}
                response = requests.get(url, params=params)
                data = response.json()
                return data['results']['p']

            # 2) Finnhub quote endpoint as a robust fallback
            if self.config.FINNHUB_API_KEY:
                url = "https://finnhub.io/api/v1/quote"
                params = {"symbol": symbol, "token": self.config.FINNHUB_API_KEY}
                resp = requests.get(url, params=params, timeout=5)
                quote = resp.json() or {}
                price = float(quote.get("c") or 0.0)
                if price > 0:
                    return price

            # 3) Yahoo Finance (yfinance) as last resort
            ticker = yf.Ticker(symbol)
            return ticker.info.get('currentPrice', 0)
        except Exception:
            # Final safety net: attempt Yahoo once more, otherwise 0
            ticker = yf.Ticker(symbol)
            return ticker.info.get('currentPrice', 0)
    
    async def get_latest_news(self, symbol: str, limit: int = 10) -> List[Dict]:
        """
        Get latest news from multiple sources
        """
        news = []
        
        # Finnhub News
        if self.config.FINNHUB_API_KEY:
            url = f"https://finnhub.io/api/v1/company-news"
            params = {
                "symbol": symbol,
                "from": (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d"),
                "to": datetime.now().strftime("%Y-%m-%d"),
                "token": self.config.FINNHUB_API_KEY
            }
            try:
                response = requests.get(url, params=params)
                finnhub_news = response.json()
                news.extend(finnhub_news[:limit])
            except:
                pass
        
        # Yahoo Finance News (fallback)
        try:
            ticker = yf.Ticker(symbol)
            yf_news = ticker.news
            news.extend(yf_news[:limit])
        except:
            pass
        
        return news
    
    async def get_sec_filings(self, symbol: str) -> List[Dict]:
        """
        Get recent SEC filings
        """
        # SEC EDGAR API
        url = f"https://data.sec.gov/submissions/CIK{self._get_cik(symbol)}.json"
        headers = {"User-Agent": "QuantTrade AI info@quanttrade.ai"}
        
        try:
            response = requests.get(url, headers=headers)
            data = response.json()
            
            filings = []
            recent_filings = data.get('filings', {}).get('recent', {})
            
            for i in range(min(10, len(recent_filings.get('form', [])))):
                filings.append({
                    "form": recent_filings['form'][i],
                    "filingDate": recent_filings['filingDate'][i],
                    "description": recent_filings['primaryDocument'][i]
                })
            
            return filings
        except:
            return []
    
    def _get_cik(self, symbol: str) -> str:
        """Get CIK number for symbol (simplified - would use lookup table)"""
        # This is a placeholder - in production, use a CIK lookup API
        cik_map = {
            "AAPL": "0000320193",
            "MSFT": "0000789019",
            "GOOGL": "0001652044",
            "TSLA": "0001318605",
            "AMZN": "0001018724"
        }
        return cik_map.get(symbol, "0000000000")
    
    async def detect_volume_anomaly(self, symbol: str) -> Optional[MarketEvent]:
        """
        Detect unusual volume activity
        """
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1mo")
        
        current_volume = hist['Volume'].iloc[-1]
        avg_volume = hist['Volume'].mean()
        std_volume = hist['Volume'].std()
        
        # Check if current volume is >3 std deviations above mean
        if current_volume > avg_volume + (3 * std_volume):
            return MarketEvent(
                event_type="ANOMALY",
                symbol=symbol,
                timestamp=datetime.now(),
                description=f"Unusual volume detected: {current_volume/1e6:.1f}M (avg: {avg_volume/1e6:.1f}M)",
                impact="BULLISH" if hist['Close'].iloc[-1] > hist['Close'].iloc[-2] else "BEARISH",
                confidence=0.75,
                data={"volume": current_volume, "average": avg_volume}
            )
        
        return None
    
    async def get_sentiment_score(self, symbol: str) -> float:
        """
        Calculate sentiment score from news and social media
        """
        news = await self.get_latest_news(symbol, limit=20)
        
        # Simple sentiment based on news headlines
        # In production, use FinBERT or similar
        positive_keywords = ['beat', 'surge', 'gain', 'profit', 'growth', 'positive', 'buy']
        negative_keywords = ['miss', 'drop', 'loss', 'decline', 'negative', 'sell', 'warning']
        
        sentiment_scores = []
        for article in news:
            headline = article.get('headline', '') or article.get('title', '')
            headline_lower = headline.lower()
            
            score = 0
            for keyword in positive_keywords:
                if keyword in headline_lower:
                    score += 1
            for keyword in negative_keywords:
                if keyword in headline_lower:
                    score -= 1
            
            sentiment_scores.append(score)
        
        if not sentiment_scores:
            return 0.0
        
        # Normalize to -1 to +1
        avg_sentiment = sum(sentiment_scores) / len(sentiment_scores)
        return max(-1.0, min(1.0, avg_sentiment / 3))

# ============================================================================
# COMPREHENSIVE ANALYSIS ENGINE
# ============================================================================

class ComprehensiveAnalyzer:
    """
    Combines all analysis types into comprehensive report
    """
    
    def __init__(self):
        self.predictor = StockPredictor()
        self.data_aggregator = RealtimeDataAggregator(AdvancedRAGConfig())
    
    async def analyze_stock(self, symbol: str) -> StockAnalysis:
        """
        Generate comprehensive stock analysis
        """
        # Get current price
        current_price = await self.data_aggregator.get_realtime_price(symbol)
        
        # Generate predictions for multiple timeframes
        predictions = []
        for name, days in AdvancedRAGConfig.PREDICTION_HORIZONS.items():
            pred = self.predictor.predict(symbol, days)
            predictions.append(pred)
        
        # Get sentiment
        sentiment_score = await self.data_aggregator.get_sentiment_score(symbol)
        
        # Technical score (from indicators)
        technical_score = self._calculate_technical_score(symbol)
        
        # Fundamental score (from financials)
        fundamental_score = self._calculate_fundamental_score(symbol)
        
        # Overall recommendation
        overall_score = (
            predictions[0].expected_return * 0.3 +
            sentiment_score * 20 +
            technical_score * 0.3 +
            fundamental_score * 0.2
        )
        
        recommendation = self._score_to_recommendation(overall_score)
        
        # Identify catalysts and risks
        catalysts = await self._identify_catalysts(symbol)
        risks = await self._identify_risks(symbol)
        
        # Get recent events
        recent_events = []
        volume_anomaly = await self.data_aggregator.detect_volume_anomaly(symbol)
        if volume_anomaly:
            recent_events.append(volume_anomaly)
        
        # Generate chart data
        chart_data = self._generate_chart_data(symbol)
        
        return StockAnalysis(
            symbol=symbol,
            current_price=current_price,
            predictions=predictions,
            sentiment_score=sentiment_score,
            technical_score=technical_score,
            fundamental_score=fundamental_score,
            overall_recommendation=recommendation,
            confidence=predictions[0].confidence,
            catalysts=catalysts,
            risks=risks,
            recent_events=recent_events,
            chart_data=chart_data
        )
    
    def _calculate_technical_score(self, symbol: str) -> float:
        """Calculate technical analysis score"""
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="3mo")
        
        score = 0.0
        
        # Moving averages
        sma_20 = hist['Close'].rolling(20).mean().iloc[-1]
        sma_50 = hist['Close'].rolling(50).mean().iloc[-1]
        current = hist['Close'].iloc[-1]
        
        if current > sma_20:
            score += 2
        if current > sma_50:
            score += 2
        if sma_20 > sma_50:
            score += 2  # Golden cross
        
        # RSI
        rsi = self.predictor._calculate_rsi(hist['Close']).iloc[-1]
        if 30 < rsi < 70:
            score += 2  # Healthy range
        elif rsi < 30:
            score += 3  # Oversold - bullish
        
        # Normalize to 0-100
        return min(100, max(0, score * 10))
    
    def _calculate_fundamental_score(self, symbol: str) -> float:
        """Calculate fundamental analysis score"""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            score = 50  # Start neutral
            
            # P/E ratio
            pe = info.get('forwardPE', 0)
            if 10 < pe < 25:
                score += 10
            elif pe < 10:
                score += 15  # Undervalued
            
            # Profit margin
            margin = info.get('profitMargins', 0) * 100
            if margin > 20:
                score += 15
            elif margin > 10:
                score += 10
            
            # Revenue growth
            growth = info.get('revenueGrowth', 0) * 100
            if growth > 15:
                score += 15
            elif growth > 5:
                score += 10
            
            # Debt to equity
            debt_ratio = info.get('debtToEquity', 100)
            if debt_ratio < 50:
                score += 10
            
            return min(100, max(0, score))
        except:
            return 50  # Neutral if data unavailable
    
    def _score_to_recommendation(self, score: float) -> str:
        """Convert score to recommendation"""
        if score > 15:
            return "STRONG_BUY"
        elif score > 5:
            return "BUY"
        elif score > -5:
            return "HOLD"
        elif score > -15:
            return "SELL"
        else:
            return "STRONG_SELL"
    
    async def _identify_catalysts(self, symbol: str) -> List[str]:
        """Identify potential catalysts"""
        catalysts = []
        
        # Check news
        news = await self.data_aggregator.get_latest_news(symbol, limit=5)
        for article in news:
            headline = article.get('headline', '') or article.get('title', '')
            if any(word in headline.lower() for word in ['earnings', 'launch', 'partnership', 'approval']):
                catalysts.append(headline[:100])
        
        # Check upcoming earnings
        ticker = yf.Ticker(symbol)
        earnings_date = ticker.calendar
        if earnings_date is not None:
            catalysts.append("Earnings report upcoming")
        
        return catalysts[:5]
    
    async def _identify_risks(self, symbol: str) -> List[str]:
        """Identify potential risks"""
        risks = []
        
        # Check news for negative keywords
        news = await self.data_aggregator.get_latest_news(symbol, limit=5)
        for article in news:
            headline = article.get('headline', '') or article.get('title', '')
            if any(word in headline.lower() for word in ['lawsuit', 'recall', 'investigation', 'decline', 'warning']):
                risks.append(headline[:100])
        
        # Technical risks
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="3mo")
        rsi = self.predictor._calculate_rsi(hist['Close']).iloc[-1]
        
        if rsi > 70:
            risks.append("Overbought on RSI (potential pullback)")
        
        # Volatility risk
        volatility = hist['Close'].pct_change().std() * 100
        if volatility > 3:
            risks.append(f"High volatility ({volatility:.1f}%)")
        
        return risks[:5]
    
    def _generate_chart_data(self, symbol: str) -> Dict[str, Any]:
        """Generate data for interactive charts"""
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="6mo")
        
        return {
            "prices": hist['Close'].tolist(),
            "volumes": hist['Volume'].tolist(),
            "dates": [d.strftime("%Y-%m-%d") for d in hist.index],
            "sma_20": hist['Close'].rolling(20).mean().tolist(),
            "sma_50": hist['Close'].rolling(50).mean().tolist()
        }

# ============================================================================
# EXAMPLE USAGE
# ============================================================================

async def main():
    """Test the comprehensive analyzer"""
    
    analyzer = ComprehensiveAnalyzer()
    
    # Analyze Apple
    print("Analyzing AAPL...")
    analysis = await analyzer.analyze_stock("AAPL")
    
    print(f"\n{'='*60}")
    print(f"AAPL ANALYSIS")
    print(f"{'='*60}\n")
    
    print(f"Current Price: ${analysis.current_price:.2f}")
    print(f"\nPredictions:")
    for pred in analysis.predictions:
        print(f"  {pred.timeframe}: ${pred.predicted_price:.2f} "
              f"({pred.direction}, {pred.confidence*100:.0f}% confident)")
    
    print(f"\nScores:")
    print(f"  Sentiment: {analysis.sentiment_score:.2f}")
    print(f"  Technical: {analysis.technical_score:.0f}/100")
    print(f"  Fundamental: {analysis.fundamental_score:.0f}/100")
    
    print(f"\nRecommendation: {analysis.overall_recommendation}")
    
    print(f"\nCatalysts:")
    for catalyst in analysis.catalysts:
        print(f"  • {catalyst}")
    
    print(f"\nRisks:")
    for risk in analysis.risks:
        print(f"  • {risk}")

if __name__ == "__main__":
    asyncio.run(main())
