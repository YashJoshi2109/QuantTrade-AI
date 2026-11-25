"""
Celery application configuration
"""
# Inject AWS Secrets Manager values BEFORE app.config reads os.environ
# (so DATABASE_URL etc. resolve from Secrets Manager, same as the web process).
try:
    from app.config_aws import inject_aws_secrets
    inject_aws_secrets()
except Exception as _aws_err:  # noqa: BLE001
    print(f"⚠️ AWS secrets load skipped (celery): {_aws_err}")

from celery import Celery
from app.config import settings

celery_app = Celery(
    "trading_copilot",
    broker=settings.CELERY_BROKER_URL if hasattr(settings, 'CELERY_BROKER_URL') else "redis://localhost:6379/0",
    backend=settings.CELERY_RESULT_BACKEND if hasattr(settings, 'CELERY_RESULT_BACKEND') else "redis://localhost:6379/0",
    include=["app.tasks.data_sync", "app.tasks.embeddings", "app.tasks.global_monitor_tasks", "app.tasks.community_sync", "app.tasks.ml_tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "sync-gdelt-news": {
            "task": "sync_gdelt_news",
            "schedule": 3600.0,  # 1 hour
        },
        "sync-usgs-earthquakes": {
            "task": "sync_usgs_earthquakes",
            "schedule": 14400.0,  # 4 hours
        },
        "sync-opensky-flights": {
            "task": "sync_opensky_flights",
            "schedule": 900.0,  # 15 minutes
        },
        # Task names must match @shared_task(name=...) in global_monitor_tasks.py;
        # the old names (sync_nasa_firms, calculate_instability_indices,
        # detect_geographic_clusters) matched no task, so beat dropped them.
        "sync-nasa-firms": {
            "task": "sync_nasa_fires",
            "schedule": 86400.0,  # Daily
        },
        "calculate-instability": {
            "task": "update_instability_indices",
            "schedule": 21600.0,  # 6 hours
        },
        "detect-clusters": {
            "task": "calculate_derived_metrics",
            "schedule": 3600.0,  # 1 hour
        },
        "sync-reddit-posts": {
            "task": "sync_reddit_posts",
            "schedule": 1800.0,  # 30 minutes
        },
        "auto-post-news": {
            "task": "auto_post_news",
            "schedule": 14400.0,  # 4 hours
        },
        "ml-drift-check": {
            "task": "ml_drift_check",
            "schedule": 21600.0,  # 6 hours
        },
        "ml-performance-check": {
            "task": "ml_performance_check",
            "schedule": 86400.0,  # daily
        },
    }
)
