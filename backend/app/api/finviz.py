import logging
from fastapi import APIRouter, HTTPException
from typing import Dict
import finviz

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/finviz/{symbol}", tags=["finviz"])
def get_finviz_data(symbol: str) -> Dict:
    """
    Fetches stock data for a given symbol from Finviz and returns it as JSON.
    """
    try:
        data = finviz.get_stock(symbol.upper())
        if not data:
            raise HTTPException(status_code=404, detail="Symbol not found on Finviz")
        return data
    except Exception as e:
        logger.exception("Finviz error")
        raise HTTPException(status_code=500, detail="Finviz error")
