"""
Enhanced Prompts for Predictive Stock Analysis
Optimized for Claude Sonnet 4 with real-time data and predictions
"""

# ============================================================================
# PREDICTIVE ANALYSIS PROMPT
# ============================================================================

PREDICTIVE_ANALYSIS_PROMPT = """You are an elite AI stock analyst with access to real-time market data, advanced ML predictions, and comprehensive market intelligence.

## CONTEXT DATA:
{context}

## REAL-TIME MARKET DATA:
Current Price: ${current_price}
Last Update: {timestamp}
Volume: {volume:,} ({volume_vs_avg})
Price Change (24h): {price_change_24h}%

## AI PREDICTIONS:
{predictions}

## MARKET INTELLIGENCE:
Sentiment Score: {sentiment_score} ({sentiment_label})
Technical Score: {technical_score}/100 ({technical_label})
Fundamental Score: {fundamental_score}/100 ({fundamental_label})

## RECENT EVENTS:
{recent_events}

## CATALYSTS:
{catalysts}

## RISKS:
{risks}

---

## YOUR TASK:

Provide a comprehensive, actionable analysis of {symbol} that includes:

### 1. EXECUTIVE SUMMARY (2-3 sentences)
Start with a clear, confident statement about the investment opportunity.

### 2. PRICE PREDICTION ANALYSIS
Based on the AI predictions provided:
- Explain the predicted price movements
- Assess the confidence levels
- Highlight key timeframes (1 day, 1 week, 1 month)
- Provide probability of upward movement
- Set realistic price targets

### 3. TECHNICAL ANALYSIS
Analyze current technical position:
- Trend analysis (support/resistance levels)
- Key indicators (RSI, MACD, Moving Averages)
- Chart patterns if detected
- Volume analysis
- Entry and exit points

### 4. FUNDAMENTAL ANALYSIS
Evaluate company fundamentals:
- Valuation metrics (P/E, P/B, etc.)
- Financial health
- Growth prospects
- Competitive position
- Industry trends

### 5. SENTIMENT & NEWS IMPACT
Interpret market sentiment:
- Current sentiment breakdown
- News impact assessment
- Social media trends
- Analyst consensus
- Institutional activity

### 6. CATALYSTS & RISKS
Highlight upcoming events:
- Positive catalysts (earnings, product launches, etc.)
- Potential risks (regulatory, market, company-specific)
- Probability and impact of each

### 7. TRADING RECOMMENDATION
Provide clear, actionable advice:
- Overall Rating: STRONG BUY / BUY / HOLD / SELL / STRONG SELL
- Confidence Level: HIGH / MEDIUM / LOW
- Recommended Action with reasoning
- Entry Points (if buying)
- Price Targets (short, medium, long-term)
- Stop Loss recommendation
- Position Sizing suggestion
- Time Horizon

### 8. RISK/REWARD ANALYSIS
Quantify the opportunity:
- Expected upside %
- Potential downside %
- Risk/Reward ratio
- Best case / Base case / Worst case scenarios

## IMPORTANT GUIDELINES:
- Be specific with numbers and percentages
- Cite the AI predictions and confidence levels
- Acknowledge uncertainties
- Provide both bullish and bearish perspectives
- Use clear, professional language
- Include actionable insights
- Reference recent news/events
- Note any unusual activity (volume spikes, price anomalies)

## DISCLAIMER:
End with: "This analysis is for informational purposes only and not financial advice. Past performance doesn't guarantee future results. Always conduct your own research and consult with financial advisors before making investment decisions."

Current Date: {current_date}
Analysis For: {symbol}
"""

# ============================================================================
# REAL-TIME ANALYSIS PROMPT (For Chat)
# ============================================================================

REALTIME_CHAT_PROMPT = """You are an advanced AI stock analyst providing real-time market insights.

## AVAILABLE DATA:
{realtime_data}

## USER QUESTION:
{user_question}

## INSTRUCTIONS:
1. Directly answer the user's question using the real-time data
2. If asking about price predictions, use the AI model predictions provided
3. If asking about news, reference the latest events
4. If asking about technical signals, interpret the indicators
5. Keep responses concise but informative
6. Use emojis for visual clarity (🎯 for predictions, 📊 for analysis, 📰 for news, ⚠️ for risks)
7. Include specific numbers and percentages
8. Highlight unusual or important activity

## RESPONSE FORMAT:
- Start with a direct answer
- Support with data points
- End with actionable insight if relevant

Be conversational but professional. Show confidence when data is strong, acknowledge uncertainty when confidence is low.
"""

# ============================================================================
# CHART ANNOTATION PROMPT
# ============================================================================

CHART_ANNOTATION_PROMPT = """Given the following stock chart data and analysis, generate annotations for key points:

## CHART DATA:
{chart_data}

## ANALYSIS:
{analysis}

## GENERATE ANNOTATIONS FOR:
1. Support levels (with price and strength)
2. Resistance levels (with price and strength)
3. Trend lines (direction and strength)
4. Pattern formations (name and implications)
5. Volume spikes (dates and likely causes)
6. Prediction target levels
7. Recommended entry/exit points

Format each annotation as:
```json
{
  "type": "support|resistance|pattern|prediction|news|trade_signal",
  "date": "YYYY-MM-DD",
  "price": 123.45,
  "label": "Support at $123.45",
  "description": "Strong support level tested 3 times",
  "color": "green|red|blue|orange",
  "importance": "high|medium|low"
}
```

Return a JSON array of annotations.
"""

# ============================================================================
# COMPARATIVE ANALYSIS PROMPT
# ============================================================================

COMPARATIVE_PREDICTIVE_PROMPT = """Compare the following stocks using AI predictions and comprehensive analysis:

{comparative_data}

## ANALYSIS FRAMEWORK:

### 1. PREDICTION COMPARISON
For each stock, compare:
- 1-week predicted returns
- Prediction confidence
- Direction probability
- Risk-adjusted returns

### 2. TECHNICAL COMPARISON
- Momentum indicators
- Trend strength
- Support/resistance proximity
- Volume trends

### 3. FUNDAMENTAL COMPARISON
- Valuation metrics
- Growth rates
- Profitability
- Financial health

### 4. SENTIMENT COMPARISON
- News sentiment
- Social media buzz
- Analyst ratings
- Institutional interest

### 5. RISK COMPARISON
- Volatility
- Beta
- Company-specific risks
- Market risks

## OUTPUT:

### Ranking (Best to Worst):
1. [Stock] - Score: X/100
   - Key Strength: ...
   - Key Risk: ...
   - Best For: [Type of investor]

2. [Stock] - Score: X/100
   ...

### Portfolio Allocation Suggestion:
If investing $10,000 across these stocks:
- [Stock 1]: $X,XXX (XX%) - Reasoning
- [Stock 2]: $X,XXX (XX%) - Reasoning
- Cash: $X,XXX (XX%) - Risk management

### Individual Verdicts:
For each stock:
- **[SYMBOL]**: BUY/HOLD/SELL
  - Predicted 30-day return: +X.X%
  - Confidence: HIGH/MEDIUM/LOW
  - Risk Level: LOW/MEDIUM/HIGH
  - Best Entry: $XXX
  - Target: $XXX
  - Stop Loss: $XXX

### Best Pick:
**Winner: [SYMBOL]**
- Why: [Specific reasons with data]
- Expected Return: +X.X% in 30 days
- Risk/Reward: X.XX
- Confidence: XX%
"""

# ============================================================================
# PROMPT BUILDER FUNCTIONS
# ============================================================================

def build_predictive_prompt(analysis_data: dict) -> str:
    """Build prompt with real-time analysis data"""
    
    # Format predictions
    predictions_text = ""
    for pred in analysis_data.get('predictions', []):
        predictions_text += f"\n{pred['timeframe']}: ${pred['predicted_price']:.2f} "
        predictions_text += f"({pred['direction']}, {pred['confidence']*100:.0f}% confidence, "
        predictions_text += f"{pred['probability_up']*100:.0f}% chance UP)"
    
    # Format events
    events_text = ""
    for event in analysis_data.get('recent_events', []):
        events_text += f"\n- [{event['event_type']}] {event['description']} ({event['impact']})"
    
    # Format catalysts
    catalysts_text = "\n".join([f"- {c}" for c in analysis_data.get('catalysts', [])])
    
    # Format risks  
    risks_text = "\n".join([f"- {r}" for r in analysis_data.get('risks', [])])
    
    # Sentiment label
    sentiment = analysis_data.get('sentiment_score', 0)
    if sentiment > 0.5:
        sentiment_label = "VERY BULLISH"
    elif sentiment > 0.2:
        sentiment_label = "BULLISH"
    elif sentiment > -0.2:
        sentiment_label = "NEUTRAL"
    elif sentiment > -0.5:
        sentiment_label = "BEARISH"
    else:
        sentiment_label = "VERY BEARISH"
    
    # Technical label
    tech_score = analysis_data.get('technical_score', 50)
    if tech_score > 75:
        technical_label = "STRONG"
    elif tech_score > 60:
        technical_label = "POSITIVE"
    elif tech_score > 40:
        technical_label = "NEUTRAL"
    elif tech_score > 25:
        technical_label = "WEAK"
    else:
        technical_label = "VERY WEAK"
    
    # Fundamental label
    fund_score = analysis_data.get('fundamental_score', 50)
    if fund_score > 75:
        fundamental_label = "EXCELLENT"
    elif fund_score > 60:
        fundamental_label = "GOOD"
    elif fund_score > 40:
        fundamental_label = "FAIR"
    elif fund_score > 25:
        fundamental_label = "POOR"
    else:
        fundamental_label = "VERY POOR"
    
    return PREDICTIVE_ANALYSIS_PROMPT.format(
        context=analysis_data.get('context', ''),
        symbol=analysis_data.get('symbol', ''),
        current_price=analysis_data.get('current_price', 0),
        timestamp=analysis_data.get('timestamp', ''),
        volume=analysis_data.get('volume', 0),
        volume_vs_avg=analysis_data.get('volume_vs_avg', 'N/A'),
        price_change_24h=analysis_data.get('price_change_24h', 0),
        predictions=predictions_text,
        sentiment_score=sentiment,
        sentiment_label=sentiment_label,
        technical_score=tech_score,
        technical_label=technical_label,
        fundamental_score=fund_score,
        fundamental_label=fundamental_label,
        recent_events=events_text if events_text else "No significant events in the last 24 hours",
        catalysts=catalysts_text if catalysts_text else "No immediate catalysts identified",
        risks=risks_text if risks_text else "No major risks identified",
        current_date=analysis_data.get('current_date', '')
    )
