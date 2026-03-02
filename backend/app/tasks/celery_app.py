"""
Celery application configuration
"""
from celery import Celery
from app.config import settings

celery_app = Celery(
    "trading_copilot",
    broker=settings.CELERY_BROKER_URL if hasattr(settings, 'CELERY_BROKER_URL') else "redis://localhost:6379/0",
    backend=settings.CELERY_RESULT_BACKEND if hasattr(settings, 'CELERY_RESULT_BACKEND') else "redis://localhost:6379/0",
    include=["app.tasks.data_sync", "app.tasks.embeddings", "app.tasks.global_monitor_tasks"]
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
        "sync-nasa-firms": {
            "task": "sync_nasa_firms",
            "schedule": 86400.0,  # Daily
        },
        "calculate-instability": {
            "task": "calculate_instability_indices",
            "schedule": 21600.0,  # 6 hours
        },
        "detect-clusters": {
            "task": "detect_geographic_clusters",
            "schedule": 3600.0,  # 1 hour
        },
    }
)
