"""
Market status API - Check if NYSE/NASDAQ is open
"""
from fastapi import APIRouter
from datetime import datetime, timedelta, timezone
import pytz

router = APIRouter()


def is_market_open() -> dict:
    """
    Check if US stock market (NYSE/NASDAQ) is currently open
    Market hours: 9:30 AM - 4:00 PM ET, Monday-Friday
    """
    # Get current time in Eastern Time
    et_tz = pytz.timezone('US/Eastern')
    now_et = datetime.now(et_tz)
    
    # Check if it's a weekday (Monday=0, Sunday=6)
    is_weekday = now_et.weekday() < 5
    
    # Market hours: 9:30 AM - 4:00 PM ET
    market_open = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
    market_close = now_et.replace(hour=16, minute=0, second=0, microsecond=0)
    
    is_open = is_weekday and market_open <= now_et <= market_close
    
    # Calculate time until open/close
    if not is_weekday:
        # Next weekday
        days_until_weekday = (5 - now_et.weekday()) % 7
        if days_until_weekday == 0:
            days_until_weekday = 1
        next_open = (now_et + timedelta(days=days_until_weekday)).replace(hour=9, minute=30, second=0, microsecond=0)
        time_until = (next_open - now_et).total_seconds()
    elif now_et < market_open:
        time_until = (market_open - now_et).total_seconds()
    elif now_et > market_close:
        # Next trading day
        days_until_weekday = (5 - now_et.weekday()) % 7
        if days_until_weekday == 0:
            days_until_weekday = 1
        next_open = (now_et + timedelta(days=days_until_weekday)).replace(hour=9, minute=30, second=0, microsecond=0)
        time_until = (next_open - now_et).total_seconds()
    else:
        time_until = (market_close - now_et).total_seconds()
    
    return {
        "is_open": is_open,
        "status": "OPEN" if is_open else "CLOSED",
        "current_time_et": now_et.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "market_open": market_open.strftime("%H:%M %Z"),
        "market_close": market_close.strftime("%H:%M %Z"),
        "is_weekday": is_weekday,
        "exchanges": {
            "NYSE": is_open,
            "NASDAQ": is_open
        }
    }


@router.get("/market/status")
async def get_market_status():
    """Get current market status (NYSE/NASDAQ open/closed)"""
    return is_market_open()
