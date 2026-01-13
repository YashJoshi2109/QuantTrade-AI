"""
Background tasks for data synchronization
"""
from app.tasks.celery_app import celery_app
from app.services.data_fetcher import DataFetcher
from app.db.database import SessionLocal


@celery_app.task(name="sync_symbol_data")
def sync_symbol_data_task(symbol: str):
    """Background task to sync symbol data"""
    db = SessionLocal()
    try:
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol)
        count = DataFetcher.sync_price_data_to_db(db, symbol)
        return {
            "symbol": symbol,
            "bars_inserted": count,
            "status": "success"
        }
    except Exception as e:
        return {
            "symbol": symbol,
            "status": "error",
            "error": str(e)
        }
    finally:
        db.close()


@celery_app.task(name="sync_all_symbols")
def sync_all_symbols_task(symbols: list[str]):
    """Background task to sync multiple symbols"""
    results = []
    for symbol in symbols:
        result = sync_symbol_data_task.delay(symbol)
        results.append(result.id)
    return {"task_ids": results}
