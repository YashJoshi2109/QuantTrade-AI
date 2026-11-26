"""
Stock screener API (public, read-only).

  GET /api/v1/screener        filter + sort + paginate the screener snapshot
  GET /api/v1/screener/meta   filters with bounds, presets, sort fields, sectors with counts

Range filters (each optional, inclusive): ``{key}_min`` / ``{key}_max`` for
  mcap ($ billions), price, pe, ps, div_yield (%), rev_growth (% YoY), margin (%),
  roe (%), de (debt/equity ratio), rsi (RSI 14), chg1d (%), chg1m (%)
Other params:
  sector=Technology|Healthcare   (pipe-separated, exact names from /meta)
  sma50=above|below, sma200=above|below   (price vs the 50/200-day simple average)
  q=<symbol prefix or name fragment>, include_etfs=true
  preset=value|growth|dividend|quality|oversold|momentum   (explicit params override)
  sort=<field from /meta>, order=asc|desc, limit=1..100 (50), offset=0..10000

A stock with an unknown metric never matches a filter on that metric, and is
sorted after known values in either direction. Bad params return 422.

Data comes only from our DB (see app.services.screener_service); no external
calls on the request path. Handlers are sync ``def`` so FastAPI runs the DB work
in its threadpool, off the event loop.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services import screener_service as svc

router = APIRouter(prefix="/screener", tags=["screener"])

CACHE_HEADER = "public, max-age=60, stale-while-revalidate=120"


@router.get("")
def screen(request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        sq = svc.parse_screen(dict(request.query_params))
    except svc.ScreenError as e:
        raise HTTPException(status_code=422, detail=str(e))
    universe, as_of, refreshing = svc.ensure_fresh(db)
    total, rows = svc.run_screen(db, sq)
    response.headers["Cache-Control"] = CACHE_HEADER
    return {
        "results": [svc.row_to_dict(r) for r in rows],
        "total": total,
        "limit": sq.limit,
        "offset": sq.offset,
        "sort": sq.sort,
        "order": sq.order,
        "preset": sq.preset,
        "filters": sq.applied(),
        "universe": universe,
        "as_of": as_of.isoformat() if as_of else None,
        "refreshing": refreshing,
    }


@router.get("/meta")
def screener_meta(response: Response, db: Session = Depends(get_db)):
    universe, as_of, _ = svc.ensure_fresh(db)
    response.headers["Cache-Control"] = "public, max-age=300"
    return {
        **svc.meta(),
        "sectors": svc.sector_counts(db),
        "universe": universe,
        "as_of": as_of.isoformat() if as_of else None,
    }
