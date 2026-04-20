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
