"""
Seed communities + real content from NewsAPI, Finnhub, and yfinance.
No Reddit API needed.

Run: cd backend && python -m scripts.seed_content
"""
import sys
import os
import re
import math
import json
import logging
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

COMMUNITIES = [
    {"slug": "wall-street-bets", "name": "Wall Street Bets", "category": "stocks",
     "description": "High-risk trades, YOLO plays, and options gambling. The internet's most famous trading community."},
    {"slug": "stocks", "name": "Stocks", "category": "stocks",
     "description": "Stock market discussion, analysis, and news for all experience levels."},
    {"slug": "investing", "name": "Investing", "category": "macro",
     "description": "Long-term investing strategies, portfolio management, and market analysis."},
    {"slug": "options-trading", "name": "Options Trading", "category": "options",
     "description": "Options strategies, Greeks, spreads, and derivatives discussion."},
    {"slug": "cryptocurrency", "name": "Cryptocurrency", "category": "crypto",
     "description": "Crypto markets, DeFi, blockchain technology, and altcoin analysis."},
    {"slug": "stock-market", "name": "Stock Market", "category": "stocks",
     "description": "General stock market analysis, sector rotation, and market commentary."},
    {"slug": "thetagang", "name": "Theta Gang", "category": "options",
     "description": "Premium selling strategies, covered calls, cash-secured puts, and theta decay plays."},
    {"slug": "value-investing", "name": "Value Investing", "category": "stocks",
     "description": "Value investing, fundamental analysis, DCF models, and long-term compounding."},
]

# Map news categories/tickers to communities
TICKER_TO_COMMUNITY = {
    "AAPL": "stocks", "MSFT": "stocks", "GOOGL": "stocks", "AMZN": "stocks",
    "NVDA": "stocks", "META": "stocks", "TSLA": "stocks", "AMD": "stocks",
    "BTC": "cryptocurrency", "ETH": "cryptocurrency", "SOL": "cryptocurrency",
    "SPY": "stock-market", "QQQ": "stock-market", "DIA": "stock-market",
}

TICKER_RE = re.compile(r'\b([A-Z]{2,5})\b')
TICKER_NOISE = {
    "I", "A", "AM", "PM", "US", "UK", "EU", "CEO", "CFO", "CTO",
    "IPO", "SEC", "FDA", "GDP", "CPI", "PPI", "ETF", "AI", "API",
    "THE", "AND", "FOR", "NOT", "ARE", "BUT", "ALL", "CAN", "HAS",
    "NEW", "NOW", "MAY", "DAY", "CEO", "CFO", "NYSE", "CEO",
}

KNOWN_TICKERS = {
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA",
    "AMD", "INTC", "NFLX", "DIS", "BA", "JPM", "GS", "BAC", "WFC",
    "V", "MA", "PYPL", "SQ", "UBER", "LYFT", "ABNB", "COIN",
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK",
    "BTC", "ETH", "SOL", "DOGE", "ADA", "XRP",
}


def extract_tickers(text: str) -> list:
    if not text:
        return []
    matches = TICKER_RE.findall(text)
    return list(dict.fromkeys(
        t for t in matches if t in KNOWN_TICKERS and t not in TICKER_NOISE
    ))[:5]


def guess_sentiment(title: str) -> str | None:
    t = title.lower()
    bull = sum(1 for w in ["surge", "rally", "gain", "rise", "jump", "soar", "beat", "record", "bull", "buy", "upgrade"] if w in t)
    bear = sum(1 for w in ["fall", "drop", "crash", "decline", "plunge", "sell", "cut", "miss", "bear", "downgrade", "loss"] if w in t)
    if bull > bear:
        return "bullish"
    if bear > bull:
        return "bearish"
    return None


def calc_hot_score(score: int, created: datetime) -> float:
    epoch = datetime(2005, 12, 8, 7, 46, 43, tzinfo=timezone.utc)
    sign = 1 if score > 0 else (-1 if score < 0 else 0)
    order = math.log10(max(abs(score), 1))
    seconds = (created - epoch).total_seconds()
    return round(sign * order + seconds / 45000, 7)


def seed_communities(db, system_user):
    from app.models.community import Community, CommunityMember
    created = 0
    for c in COMMUNITIES:
        existing = db.query(Community).filter(Community.slug == c["slug"]).first()
        if existing:
            logger.info(f"  SKIP  {c['slug']} (exists)")
            continue
        community = Community(
            slug=c["slug"], name=c["name"], description=c["description"],
            category=c["category"], created_by=system_user.id, member_count=1,
        )
        db.add(community)
        db.flush()
        db.add(CommunityMember(community_id=community.id, user_id=system_user.id, role="owner"))
        created += 1
        logger.info(f"  CREATE  {c['slug']}")
    db.commit()
    logger.info(f"Communities: {created} created, {len(COMMUNITIES) - created} existed")
    return created


def seed_newsapi(db, system_user):
    """Fetch financial news from NewsAPI and create posts."""
    import httpx
    from app.config import settings
    from app.models.community import Community, Post

    if not settings.NEWSAPI_KEY:
        logger.warning("NEWSAPI_KEY not set — skipping NewsAPI seed")
        return 0

    communities = {c.slug: c for c in db.query(Community).all()}
    default_community = communities.get("stock-market")
    if not default_community:
        logger.warning("stock-market community not found")
        return 0

    created = 0
    categories = ["business", "technology"]
    queries = ["stocks", "wall street", "cryptocurrency", "investing", "earnings", "federal reserve", "IPO", "nasdaq"]

    # Top headlines
    for cat in categories:
        try:
            resp = httpx.get(
                "https://newsapi.org/v2/top-headlines",
                params={"category": cat, "language": "en", "pageSize": 20, "apiKey": settings.NEWSAPI_KEY},
                timeout=15,
            )
            if resp.status_code != 200:
                continue
            for article in resp.json().get("articles", []):
                title = article.get("title", "")
                url = article.get("url", "")
                source = article.get("source", {}).get("name", "")
                description = article.get("description", "") or ""
                if not title or not url or "[Removed]" in title:
                    continue
                existing = db.query(Post.id).filter(Post.source_url == url).first()
                if existing:
                    continue

                tickers = extract_tickers(f"{title} {description}")
                sentiment = guess_sentiment(title)
                # Pick community based on tickers
                target = default_community
                for t in tickers:
                    slug = TICKER_TO_COMMUNITY.get(t)
                    if slug and slug in communities:
                        target = communities[slug]
                        break

                now = datetime.now(timezone.utc)
                post = Post(
                    author_id=system_user.id, community_id=target.id,
                    title=f"[News] {title[:280]}", body=f"{description}\n\n---\n*Source: {source}*",
                    post_type="news", tickers=tickers, sentiment=sentiment,
                    source_url=url, source_platform="newsapi",
                    moderation_status="approved", hot_score=calc_hot_score(10, now),
                    upvote_count=10,
                )
                db.add(post)
                created += 1
        except Exception as e:
            logger.error(f"NewsAPI {cat} error: {e}")

    # Keyword searches for more variety
    for query in queries:
        try:
            resp = httpx.get(
                "https://newsapi.org/v2/everything",
                params={"q": query, "language": "en", "pageSize": 10, "sortBy": "publishedAt", "apiKey": settings.NEWSAPI_KEY},
                timeout=15,
            )
            if resp.status_code != 200:
                continue
            for article in resp.json().get("articles", [])[:5]:
                title = article.get("title", "")
                url = article.get("url", "")
                source = article.get("source", {}).get("name", "")
                description = article.get("description", "") or ""
                if not title or not url or "[Removed]" in title:
                    continue
                existing = db.query(Post.id).filter(Post.source_url == url).first()
                if existing:
                    continue

                tickers = extract_tickers(f"{title} {description}")
                sentiment = guess_sentiment(title)
                target = default_community
                for t in tickers:
                    slug = TICKER_TO_COMMUNITY.get(t)
                    if slug and slug in communities:
                        target = communities[slug]
                        break
                # Map query to community
                if "crypto" in query.lower():
                    target = communities.get("cryptocurrency", target)
                elif "invest" in query.lower():
                    target = communities.get("investing", target)
                elif "IPO" in query:
                    target = communities.get("stocks", target)

                now = datetime.now(timezone.utc)
                post = Post(
                    author_id=system_user.id, community_id=target.id,
                    title=f"[News] {title[:280]}", body=f"{description}\n\n---\n*Source: {source}*",
                    post_type="news", tickers=tickers, sentiment=sentiment,
                    source_url=url, source_platform="newsapi",
                    moderation_status="approved", hot_score=calc_hot_score(5, now),
                    upvote_count=5,
                )
                db.add(post)
                created += 1
        except Exception as e:
            logger.error(f"NewsAPI query '{query}' error: {e}")

    db.commit()
    # Update post counts
    for slug, comm in communities.items():
        count = db.query(Post).filter(Post.community_id == comm.id).count()
        comm.post_count = count
    db.commit()
    logger.info(f"NewsAPI: {created} posts created")
    return created


def seed_finnhub_news(db, system_user):
    """Fetch market news from Finnhub."""
    import httpx
    from app.config import settings
    from app.models.community import Community, Post

    if not settings.FINNHUB_API_KEY:
        logger.warning("FINNHUB_API_KEY not set — skipping Finnhub seed")
        return 0

    communities = {c.slug: c for c in db.query(Community).all()}
    default_community = communities.get("stock-market")
    if not default_community:
        return 0

    created = 0
    try:
        resp = httpx.get(
            "https://finnhub.io/api/v1/news",
            params={"category": "general", "token": settings.FINNHUB_API_KEY},
            timeout=15,
        )
        if resp.status_code != 200:
            return 0
        for article in resp.json()[:30]:
            title = article.get("headline", "")
            url = article.get("url", "")
            source = article.get("source", "")
            summary = article.get("summary", "")
            if not title or not url:
                continue
            existing = db.query(Post.id).filter(Post.source_url == url).first()
            if existing:
                continue

            tickers = extract_tickers(f"{title} {summary}")
            sentiment = guess_sentiment(title)
            target = default_community
            for t in tickers:
                slug = TICKER_TO_COMMUNITY.get(t)
                if slug and slug in communities:
                    target = communities[slug]
                    break

            now = datetime.now(timezone.utc)
            post = Post(
                author_id=system_user.id, community_id=target.id,
                title=f"[News] {title[:280]}", body=f"{summary[:2000]}\n\n---\n*Source: {source}*",
                post_type="news", tickers=tickers, sentiment=sentiment,
                source_url=url, source_platform="finnhub",
                moderation_status="approved", hot_score=calc_hot_score(8, now),
                upvote_count=8,
            )
            db.add(post)
            created += 1
    except Exception as e:
        logger.error(f"Finnhub news error: {e}")

    db.commit()
    for slug, comm in communities.items():
        count = db.query(Post).filter(Post.community_id == comm.id).count()
        comm.post_count = count
    db.commit()
    logger.info(f"Finnhub: {created} posts created")
    return created


def seed_market_commentary(db, system_user):
    """Generate market commentary posts from yfinance data."""
    from app.models.community import Community, Post

    communities = {c.slug: c for c in db.query(Community).all()}
    stock_market = communities.get("stock-market")
    if not stock_market:
        return 0

    created = 0
    try:
        import yfinance as yf

        indices = {"SPY": "S&P 500", "QQQ": "Nasdaq 100", "DIA": "Dow Jones", "IWM": "Russell 2000"}
        for symbol, name in indices.items():
            try:
                ticker = yf.Ticker(symbol)
                hist = ticker.history(period="5d")
                if hist.empty or len(hist) < 2:
                    continue
                latest = hist.iloc[-1]
                prev = hist.iloc[-2]
                change = ((latest["Close"] - prev["Close"]) / prev["Close"]) * 100
                direction = "up" if change > 0 else "down"
                sentiment = "bullish" if change > 0 else "bearish"

                title = f"Market Update: {name} ({symbol}) {direction} {abs(change):.1f}%"
                body = (
                    f"**{name} ({symbol})** closed at **${latest['Close']:.2f}**, "
                    f"{'gaining' if change > 0 else 'losing'} {abs(change):.2f}% from the previous session.\n\n"
                    f"- Open: ${latest['Open']:.2f}\n"
                    f"- High: ${latest['High']:.2f}\n"
                    f"- Low: ${latest['Low']:.2f}\n"
                    f"- Volume: {int(latest['Volume']):,}\n\n"
                    f"---\n*Auto-generated market update from QuantTrade-AI*"
                )

                now = datetime.now(timezone.utc)
                post = Post(
                    author_id=system_user.id, community_id=stock_market.id,
                    title=title, body=body, post_type="market_update",
                    tickers=[symbol], sentiment=sentiment,
                    source_platform="yfinance", moderation_status="approved",
                    hot_score=calc_hot_score(15, now), upvote_count=15,
                )
                db.add(post)
                created += 1
            except Exception as e:
                logger.error(f"yfinance {symbol}: {e}")

        # Top movers
        try:
            movers = ["NVDA", "AAPL", "MSFT", "TSLA", "AMD", "META", "GOOGL", "AMZN"]
            for symbol in movers:
                ticker = yf.Ticker(symbol)
                info = ticker.info or {}
                hist = ticker.history(period="5d")
                if hist.empty or len(hist) < 2:
                    continue
                latest = hist.iloc[-1]
                prev = hist.iloc[-2]
                change = ((latest["Close"] - prev["Close"]) / prev["Close"]) * 100
                if abs(change) < 1.0:
                    continue  # skip small moves

                company = info.get("shortName", symbol)
                direction = "surges" if change > 2 else ("rises" if change > 0 else ("drops" if change < -2 else "dips"))
                sentiment = "bullish" if change > 0 else "bearish"

                target = communities.get("stocks", stock_market)
                title = f"{company} ({symbol}) {direction} {abs(change):.1f}% — ${latest['Close']:.2f}"
                body = (
                    f"**{company} ({symbol})** {'gained' if change > 0 else 'lost'} {abs(change):.2f}% today.\n\n"
                    f"- Close: ${latest['Close']:.2f}\n"
                    f"- Volume: {int(latest['Volume']):,}\n\n"
                    f"What's your take? Bullish or bearish from here?\n\n"
                    f"---\n*Auto-generated from QuantTrade-AI market data*"
                )

                now = datetime.now(timezone.utc)
                post = Post(
                    author_id=system_user.id, community_id=target.id,
                    title=title, body=body, post_type="market_update",
                    tickers=[symbol], sentiment=sentiment,
                    source_platform="yfinance", moderation_status="approved",
                    hot_score=calc_hot_score(12, now), upvote_count=12,
                )
                db.add(post)
                created += 1
        except Exception as e:
            logger.error(f"Movers error: {e}")

    except ImportError:
        logger.warning("yfinance not available")

    db.commit()
    for slug, comm in communities.items():
        count = db.query(Post).filter(Post.community_id == comm.id).count()
        comm.post_count = count
    db.commit()
    logger.info(f"Market commentary: {created} posts created")
    return created


def main():
    from app.db.database import SessionLocal
    from app.models.user import User

    db = SessionLocal()
    try:
        system_user = db.query(User).first()
        if not system_user:
            logger.error("No users in database. Create a user first.")
            return

        logger.info(f"System user: {system_user.username} (id={system_user.id})")
        logger.info("")

        logger.info("=== Step 1: Seed Communities ===")
        seed_communities(db, system_user)
        logger.info("")

        logger.info("=== Step 2: NewsAPI Posts ===")
        news_count = seed_newsapi(db, system_user)
        logger.info("")

        logger.info("=== Step 3: Finnhub News ===")
        finnhub_count = seed_finnhub_news(db, system_user)
        logger.info("")

        logger.info("=== Step 4: Market Commentary ===")
        market_count = seed_market_commentary(db, system_user)
        logger.info("")

        total = news_count + finnhub_count + market_count
        logger.info(f"=== DONE: {total} total posts seeded across 8 communities ===")

    finally:
        db.close()


if __name__ == "__main__":
    main()
