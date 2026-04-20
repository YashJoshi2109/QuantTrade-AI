"""
Reddit financial content ingestion service.

Fetches top posts from financial subreddits and stores them
as community posts with source attribution.
"""
import re
import logging
import asyncio
from typing import List, Dict, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Ticker extraction: matches $AAPL or standalone 1-5 letter uppercase
TICKER_RE = re.compile(r'\$([A-Z]{1,5})\b')

# Known noise words that match ticker pattern but aren't tickers
TICKER_NOISE = {
    "I", "A", "AM", "PM", "US", "UK", "EU", "CEO", "CFO", "CTO",
    "IPO", "SEC", "FDA", "GDP", "CPI", "PPI", "ATH", "ATL", "DD",
    "IMO", "TBH", "FYI", "PSA", "OP", "EDIT", "TLDR", "WSB",
    "ETF", "LOL", "YOLO", "FOMO", "FUD", "HODL", "BEAR", "BULL",
    "THE", "AND", "FOR", "NOT", "ARE", "BUT", "ALL", "CAN", "HAS",
    "HER", "WAS", "ONE", "OUR", "OUT", "YOU", "HAD", "HOT", "OLD",
    "RED", "NEW", "NOW", "WAY", "MAY", "DAY", "TOO", "ANY",
}

# Subreddit -> community slug mapping
SUBREDDIT_MAP = {
    "wallstreetbets": {"slug": "wall-street-bets", "category": "stocks", "name": "Wall Street Bets", "description": "High-risk trades, YOLO plays, and options gambling. The internet's most famous trading community."},
    "stocks": {"slug": "stocks", "category": "stocks", "name": "Stocks", "description": "Stock market discussion, analysis, and news for all experience levels."},
    "investing": {"slug": "investing", "category": "macro", "name": "Investing", "description": "Long-term investing strategies, portfolio management, and market analysis."},
    "options": {"slug": "options-trading", "category": "options", "name": "Options Trading", "description": "Options strategies, Greeks, spreads, and derivatives discussion."},
    "CryptoCurrency": {"slug": "cryptocurrency", "category": "crypto", "name": "Cryptocurrency", "description": "Crypto markets, DeFi, blockchain technology, and altcoin analysis."},
    "StockMarket": {"slug": "stock-market", "category": "stocks", "name": "Stock Market", "description": "General stock market analysis, sector rotation, and market commentary."},
    "thetagang": {"slug": "thetagang", "category": "options", "name": "Theta Gang", "description": "Premium selling strategies, covered calls, cash-secured puts, and theta decay plays."},
    "ValueInvesting": {"slug": "value-investing", "category": "stocks", "name": "Value Investing", "description": "Value investing, fundamental analysis, DCF models, and long-term compounding."},
}


def extract_tickers(text: str) -> List[str]:
    """Extract stock tickers from text. Matches $AAPL pattern."""
    if not text:
        return []
    matches = TICKER_RE.findall(text)
    return list(dict.fromkeys(t for t in matches if t not in TICKER_NOISE))[:10]


def _guess_sentiment(title: str, score: int) -> Optional[str]:
    """Basic heuristic sentiment from title keywords + vote score."""
    title_lower = title.lower()
    bullish_words = {"moon", "rocket", "calls", "long", "buy", "bull", "green", "breakout", "undervalued", "upside", "gains"}
    bearish_words = {"puts", "short", "sell", "bear", "crash", "overvalued", "downside", "dump", "red", "correction"}
    bull_count = sum(1 for w in bullish_words if w in title_lower)
    bear_count = sum(1 for w in bearish_words if w in title_lower)
    if bull_count > bear_count:
        return "bullish"
    if bear_count > bull_count:
        return "bearish"
    return None


class RedditIngestionService:
    """Fetches financial posts from Reddit and stores them as community posts."""

    def __init__(self):
        self._reddit = None

    async def _get_reddit(self):
        """Lazy init async Reddit client."""
        if self._reddit is None:
            try:
                import asyncpraw
                from app.config import settings
                if not settings.REDDIT_CLIENT_ID or not settings.REDDIT_CLIENT_SECRET:
                    logger.warning("Reddit API credentials not configured")
                    return None
                self._reddit = asyncpraw.Reddit(
                    client_id=settings.REDDIT_CLIENT_ID,
                    client_secret=settings.REDDIT_CLIENT_SECRET,
                    user_agent=settings.REDDIT_USER_AGENT,
                )
            except ImportError:
                logger.warning("asyncpraw not installed — pip install asyncpraw")
                return None
            except Exception as e:
                logger.error(f"Reddit client init failed: {e}")
                return None
        return self._reddit

    async def fetch_subreddit_posts(
        self,
        subreddit_name: str,
        sort: str = "hot",
        limit: int = 50,
    ) -> List[Dict]:
        """Fetch posts from a subreddit. Returns normalized dicts."""
        reddit = await self._get_reddit()
        if not reddit:
            return []

        posts = []
        try:
            subreddit = await reddit.subreddit(subreddit_name)
            if sort == "hot":
                submissions = subreddit.hot(limit=limit)
            elif sort == "top":
                submissions = subreddit.top(time_filter="week", limit=limit)
            else:
                submissions = subreddit.new(limit=limit)

            async for submission in submissions:
                if submission.stickied or submission.is_self is False and not submission.selftext:
                    continue  # skip stickied mod posts and link-only posts without text

                tickers = extract_tickers(f"{submission.title} {submission.selftext or ''}")
                sentiment = _guess_sentiment(submission.title, submission.score)

                posts.append({
                    "reddit_id": submission.id,
                    "title": submission.title[:300],
                    "body": (submission.selftext or "")[:10000],
                    "author": str(submission.author) if submission.author else "[deleted]",
                    "score": submission.score,
                    "num_comments": submission.num_comments,
                    "permalink": f"https://reddit.com{submission.permalink}",
                    "created_utc": datetime.fromtimestamp(submission.created_utc, tz=timezone.utc),
                    "tickers": tickers,
                    "sentiment": sentiment,
                    "subreddit": subreddit_name,
                    "flair": submission.link_flair_text,
                })
        except Exception as e:
            logger.error(f"Error fetching r/{subreddit_name}: {e}")

        return posts

    async def ingest_to_db(
        self,
        db,
        system_user_id: int,
        subreddits: Optional[List[str]] = None,
        limit_per_sub: int = 50,
    ) -> Dict[str, int]:
        """
        Fetch from Reddit and store as Post records.
        Returns counts: {subreddit: num_new_posts}.
        """
        from app.models.community import Community, CommunityMember, Post
        import math

        subreddits = subreddits or list(SUBREDDIT_MAP.keys())
        results = {}

        for sub_name in subreddits:
            mapping = SUBREDDIT_MAP.get(sub_name)
            if not mapping:
                continue

            # Get or create community
            community = db.query(Community).filter(Community.slug == mapping["slug"]).first()
            if not community:
                community = Community(
                    slug=mapping["slug"],
                    name=mapping["name"],
                    description=mapping["description"],
                    category=mapping["category"],
                    created_by=system_user_id,
                    member_count=1,
                    settings={"source": "reddit", "subreddit": sub_name},
                )
                db.add(community)
                db.flush()
                # Add system user as owner
                db.add(CommunityMember(
                    community_id=community.id,
                    user_id=system_user_id,
                    role="owner",
                ))
                db.flush()

            # Fetch posts
            raw_posts = await self.fetch_subreddit_posts(sub_name, sort="hot", limit=limit_per_sub)
            # Also fetch top of week for variety
            raw_posts.extend(await self.fetch_subreddit_posts(sub_name, sort="top", limit=limit_per_sub // 2))

            new_count = 0
            for rp in raw_posts:
                # Deduplicate by source_url
                existing = db.query(Post.id).filter(Post.source_url == rp["permalink"]).first()
                if existing:
                    continue

                # Calculate hot score
                score = rp["score"]
                sign = 1 if score > 0 else (-1 if score < 0 else 0)
                order = math.log10(max(abs(score), 1))
                seconds = (rp["created_utc"] - datetime(2005, 12, 8, 7, 46, 43, tzinfo=timezone.utc)).total_seconds()
                hot_score = round(sign * order + seconds / 45000, 7)

                # Build attribution body
                body = rp["body"]
                if body:
                    body = f"{body}\n\n---\n*Originally posted on Reddit by u/{rp['author']}*"
                else:
                    body = f"*Originally posted on Reddit by u/{rp['author']}*"

                post = Post(
                    author_id=system_user_id,
                    community_id=community.id,
                    title=rp["title"],
                    body=body,
                    post_type="external",
                    tickers=rp["tickers"],
                    sentiment=rp["sentiment"],
                    upvote_count=max(rp["score"], 0),
                    downvote_count=max(-rp["score"], 0) if rp["score"] < 0 else 0,
                    comment_count=rp["num_comments"],
                    hot_score=hot_score,
                    source_url=rp["permalink"],
                    source_platform="reddit",
                    flair=rp.get("flair"),
                    moderation_status="approved",
                )
                db.add(post)
                new_count += 1

            if new_count > 0:
                community.post_count = (community.post_count or 0) + new_count

            results[sub_name] = new_count

        db.commit()
        total = sum(results.values())
        logger.info(f"Reddit ingestion complete: {total} new posts from {len(results)} subreddits")
        return results

    async def close(self):
        """Close the Reddit client session."""
        if self._reddit:
            await self._reddit.close()
            self._reddit = None


# Module-level singleton
reddit_ingestion_service = RedditIngestionService()
