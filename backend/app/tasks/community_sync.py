"""
Community content sync tasks — Reddit ingestion + news auto-posting.
"""
import asyncio
import logging
from app.tasks.celery_app import celery_app
from app.db.database import SessionLocal

logger = logging.getLogger(__name__)


def _run_async(coro):
    """Run an async function from sync Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(name="sync_reddit_posts", bind=True, max_retries=2)
def sync_reddit_posts(self):
    """
    Periodic task: fetch new posts from financial subreddits.
    Runs every 30 minutes via Celery Beat.
    """
    db = SessionLocal()
    try:
        from app.services.reddit_ingestion_service import reddit_ingestion_service
        from app.models.user import User

        # Use first admin user as system author
        system_user = db.query(User).filter(User.role == "admin").first()
        if not system_user:
            system_user = db.query(User).first()
        if not system_user:
            logger.error("No users in database — cannot sync Reddit posts")
            return {"status": "error", "reason": "no_users"}

        results = _run_async(
            reddit_ingestion_service.ingest_to_db(
                db=db,
                system_user_id=system_user.id,
                limit_per_sub=25,  # 25 per sub for ongoing sync (not initial seed)
            )
        )

        total = sum(results.values())
        logger.info(f"Reddit sync: {total} new posts ingested")
        return {"status": "success", "new_posts": total, "by_subreddit": results}

    except Exception as e:
        logger.error(f"Reddit sync failed: {e}")
        raise self.retry(exc=e, countdown=300)
    finally:
        db.close()


@celery_app.task(name="seed_reddit_initial")
def seed_reddit_initial():
    """
    One-time task: initial seed of 800+ posts from Reddit.
    Run manually: celery -A app.tasks.celery_app call seed_reddit_initial
    """
    db = SessionLocal()
    try:
        from app.services.reddit_ingestion_service import reddit_ingestion_service
        from app.models.user import User

        system_user = db.query(User).filter(User.role == "admin").first()
        if not system_user:
            system_user = db.query(User).first()
        if not system_user:
            return {"status": "error", "reason": "no_users"}

        results = _run_async(
            reddit_ingestion_service.ingest_to_db(
                db=db,
                system_user_id=system_user.id,
                limit_per_sub=100,  # 100 per sub for initial seed
            )
        )

        total = sum(results.values())
        logger.info(f"Reddit initial seed: {total} posts ingested")
        return {"status": "success", "new_posts": total, "by_subreddit": results}

    except Exception as e:
        logger.error(f"Reddit initial seed failed: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="auto_post_news")
def auto_post_news():
    """
    Fetch top financial news and auto-post to relevant communities.
    Runs every 4 hours via Celery Beat.
    """
    db = SessionLocal()
    try:
        from app.models.community import Community, Post
        from app.models.user import User
        from app.services.sentiment_service import sentiment_service
        import httpx
        from app.config import settings

        system_user = db.query(User).filter(User.role == "admin").first()
        if not system_user:
            system_user = db.query(User).first()
        if not system_user:
            return {"status": "error", "reason": "no_users"}

        # Try NewsAPI
        if not settings.NEWSAPI_KEY:
            logger.warning("NEWSAPI_KEY not configured, skipping news auto-post")
            return {"status": "skipped", "reason": "no_api_key"}

        response = httpx.get(
            "https://newsapi.org/v2/top-headlines",
            params={"category": "business", "language": "en", "pageSize": 10, "apiKey": settings.NEWSAPI_KEY},
            timeout=15,
        )
        if response.status_code != 200:
            return {"status": "error", "reason": f"API returned {response.status_code}"}

        articles = response.json().get("articles", [])
        stock_market = db.query(Community).filter(Community.slug == "stock-market").first()
        if not stock_market:
            return {"status": "error", "reason": "stock-market community not found"}

        created = 0
        for article in articles[:5]:
            title = article.get("title", "")
            url = article.get("url", "")
            source = article.get("source", {}).get("name", "Unknown")
            description = article.get("description", "")

            if not title or not url:
                continue

            # Deduplicate
            existing = db.query(Post.id).filter(Post.source_url == url).first()
            if existing:
                continue

            # Score sentiment
            result = sentiment_service.score_text(f"{title} {description}")

            image_url = article.get("urlToImage", "") or ""
            body = f"{description}\n\n---\n*Source: {source}*"
            post = Post(
                author_id=system_user.id,
                community_id=stock_market.id,
                title=f"[News] {title[:280]}",
                body=body,
                post_type="news",
                sentiment=result.label,
                sentiment_confidence=result.confidence,
                source_url=url,
                source_platform="newsapi",
                moderation_status="approved",
                tickers=[],
                media_urls=[image_url] if image_url else [],
            )
            db.add(post)
            created += 1

        if created > 0:
            stock_market.post_count = (stock_market.post_count or 0) + created
            db.commit()

        return {"status": "success", "news_posted": created}
    except Exception as e:
        logger.error(f"News auto-post failed: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        db.close()
