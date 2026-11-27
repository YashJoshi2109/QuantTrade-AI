"""
Market status API - Check if NYSE/NASDAQ is open
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter

from app.services import market_calendar as mc

router = APIRouter()


def is_market_open(at: Optional[datetime] = None) -> dict:
    """
    Check if the US stock market (NYSE/NASDAQ) is in its regular session.
    Regular hours: 9:30 AM - 4:00 PM ET (1:00 PM on early-close days) on
    trading days; exchange holidays (e.g. Thanksgiving) are closed.
    """
    st = mc.market_state(at)
    now_et = st.now_et
    close = st.close_today or mc.CLOSE
    market_open = now_et.replace(hour=mc.OPEN.hour, minute=mc.OPEN.minute, second=0, microsecond=0)
    market_close = now_et.replace(hour=close.hour, minute=close.minute, second=0, microsecond=0)
    if st.is_open:
        time_until = (market_close - now_et).total_seconds()
    else:
        time_until = (st.next_open - now_et).total_seconds()

    return {
        "is_open": st.is_open,
        "status": "OPEN" if st.is_open else "CLOSED",
        "session": st.session,
        "holiday": st.holiday,
        "early_close": st.early_close,
        "current_time_et": now_et.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "market_open": market_open.strftime("%H:%M %Z"),
        "market_close": market_close.strftime("%H:%M %Z"),
        "next_open_et": st.next_open.strftime("%Y-%m-%d %H:%M %Z"),
        "seconds_until_change": int(time_until),
        "is_weekday": now_et.weekday() < 5,
        "exchanges": {
            "NYSE": st.is_open,
            "NASDAQ": st.is_open
        }
    }


@router.get("/market/status")
def get_market_status():
    """Get current market status (NYSE/NASDAQ open/closed)"""
    return is_market_open()
