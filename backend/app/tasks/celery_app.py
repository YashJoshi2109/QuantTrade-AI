"""
Celery application configuration
"""
from celery import Celery
from app.config import settings

celery_app = Celery(
    "trading_copilot",
    broker=settings.CELERY_BROKER_URL if hasattr(settings, 'CELERY_BROKER_URL') else "redis://localhost:6379/0",
    backend=settings.CELERY_RESULT_BACKEND if hasattr(settings, 'CELERY_RESULT_BACKEND') else "redis://localhost:6379/0",
    include=["app.tasks.data_sync", "app.tasks.embeddings"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)
