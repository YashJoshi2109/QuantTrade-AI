"""
Background Scheduler Jobs for Real-Time Ideas Lab

Runs periodic tasks via APScheduler:
- Every 5 min: re-score all stocks, update cached ideas
- Every 2 min: update market pulse
- Market open (9:30 ET): full universe rescan
- Every 10 min: news sentiment check

All updates are pushed via Redis pub/sub -> WebSocket.
"""
import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# We need a shared event loop for async jobs in sync scheduler
_loop = None


def _get_loop():
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
    return _loop


def _run_async(coro):
    """Run async coroutine from sync scheduler context."""
    loop = _get_loop()
    return loop.run_until_complete(coro)


async def _rescore_ideas_async():
    """Re-score all stocks with real data and update caches + WebSocket."""
    from app.services.market_data_service import market_data
    from app.services.technical_analysis_service import ta_service
    from app.services.redis_cache_service import cache_service
    from app.api.ideas import ALL_SYMBOLS, _build_idea_from_signals, _build_market_pulse

    logger.info("🔄 Scheduler: rescoring ideas with real market data...")

    try:
        # Batch fetch all quotes
        symbols = [s[0] for s in ALL_SYMBOLS]
        quotes = await market_data.get_quotes_batch(symbols)

        ideas = []
        sources = set()

        for sym, name, sector in ALL_SYMBOLS:
            quote = quotes.get(sym)
            if not quote or not quote.price:
                continue
            sources.add(quote.source)

            signals = await ta_service.compute_signals(sym)
            if not signals:
                continue

            idea = _build_idea_from_signals(sym, name, sector, quote, signals)
            if idea and idea.confidence >= 35:
                ideas.append(idea)

        ideas.sort(key=lambda i: i.confidence, reverse=True)

        # Build market pulse
        pulse = await _build_market_pulse(ideas, len(ALL_SYMBOLS))

        # Cache results
        trending_data = {
            "ideas": [i.model_dump() for i in ideas[:20]],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "market_pulse": pulse,
            "is_live": True,
            "data_sources_used": list(sources),
            "ipo_calendar": [],
        }
        await cache_service.set("qt:ideas:trending", trending_data, 300)

        # Push to WebSocket via Redis pub/sub
        await cache_service.publish("qt:ws:ideas", {
            "type": "ideas_update",
            "data": trending_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        logger.info(f"✅ Scheduler: rescored {len(ideas)} ideas from {len(quotes)} stocks (sources: {sources})")

    except Exception as e:
        logger.error(f"❌ Scheduler rescore error: {e}")


async def _update_market_pulse_async():
    """Update market pulse with real-time index + sector data."""
    from app.services.market_data_service import market_data
    from app.services.redis_cache_service import cache_service

    logger.info("📊 Scheduler: updating market pulse...")

    try:
        # Fetch major indices (^VIX is the Yahoo Finance ticker for VIX)
        index_symbols = ["SPY", "QQQ", "DIA", "IWM", "^VIX"]
        quotes = await market_data.get_quotes_batch(index_symbols)

        # Fetch sector ETFs
        sector_etfs = ["XLK", "XLV", "XLF", "XLY", "XLE", "XLI"]
        sector_quotes = await market_data.get_quotes_batch(sector_etfs)

        sector_map = {
            "XLK": "Technology", "XLV": "Healthcare", "XLF": "Financials",
            "XLY": "Consumer", "XLE": "Energy", "XLI": "Industrials",
        }

        pulse = {
            "indices": {
                sym: {"price": q.price, "change_pct": q.change_pct, "source": q.source}
                for sym, q in quotes.items() if q
            },
            "sectors": {
                sector_map.get(sym, sym): {
                    "etf": sym,
                    "change_pct": q.change_pct,
                    "sentiment": "bullish" if q.change_pct > 0.3 else (
                        "bearish" if q.change_pct < -0.3 else "neutral"
                    ),
                    "source": q.source,
                }
                for sym, q in sector_quotes.items() if q
            },
            "vix": quotes.get("^VIX").price if quotes.get("^VIX") else None,
            "market_regime": _detect_regime(quotes),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        await cache_service.set("qt:pulse:market", pulse, 120)

        # Push to WebSocket
        await cache_service.publish("qt:ws:pulse", {
            "type": "pulse_update",
            "data": pulse,
        })

        logger.info(f"✅ Scheduler: market pulse updated ({len(quotes)} indices, {len(sector_quotes)} sectors)")

    except Exception as e:
        logger.error(f"❌ Scheduler pulse error: {e}")


def _detect_regime(index_quotes: dict) -> str:
    """Detect market regime from VIX + SPY."""
    vix_quote = index_quotes.get("^VIX")
    spy_quote = index_quotes.get("SPY")

    if not vix_quote or not spy_quote:
        return "unknown"

    vix = vix_quote.price if hasattr(vix_quote, 'price') else 0
    spy_change = spy_quote.change_pct if hasattr(spy_quote, 'change_pct') else 0

    if vix > 30:
        return "high_volatility"
    elif vix > 20 and spy_change < -1:
        return "risk_off"
    elif vix < 15 and spy_change > 0.5:
        return "risk_on"
    elif spy_change > 1:
        return "bullish"
    elif spy_change < -1:
        return "bearish"
    return "neutral"


async def _news_sentiment_check_async():
    """Check latest news and re-score affected stocks."""
    from app.services.redis_cache_service import cache_service

    logger.info("📰 Scheduler: checking news sentiment...")

    try:
        # Use Finnhub for market news
        from app.services.finnhub_fetcher import FinnhubFetcher
        news = FinnhubFetcher.get_market_news(category="general", limit=10, priority="normal")

        if news:
            # Extract mentioned symbols
            affected_symbols = set()
            for article in news:
                related = article.get("related", "")
                if related:
                    affected_symbols.update(s.strip() for s in related.split(",") if s.strip())

            if affected_symbols:
                # Invalidate caches for affected symbols
                for sym in list(affected_symbols)[:20]:
                    await cache_service.delete(f"qt:quote:{sym}")
                    await cache_service.delete(f"qt:ta:{sym}")

                logger.info(f"✅ News sentiment: invalidated caches for {len(affected_symbols)} symbols")

                # Publish news update
                await cache_service.publish("qt:ws:ideas", {
                    "type": "news_update",
                    "affected_symbols": list(affected_symbols)[:20],
                    "article_count": len(news),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

    except Exception as e:
        logger.error(f"❌ Scheduler news error: {e}")


async def _market_open_scan_async():
    """Full universe rescan at market open."""
    logger.info("🔔 Scheduler: market open — running full universe scan...")
    # Invalidate all caches for fresh data
    from app.services.redis_cache_service import cache_service
    await cache_service.invalidate_pattern("qt:quote:*")
    await cache_service.invalidate_pattern("qt:ta:*")
    await cache_service.invalidate_pattern("qt:batch:*")
    # Run full rescore
    await _rescore_ideas_async()
    logger.info("✅ Scheduler: market open scan complete")


# ── Sync wrappers for APScheduler ────────────────────────────────────────

def rescore_ideas():
    _run_async(_rescore_ideas_async())


def update_market_pulse():
    _run_async(_update_market_pulse_async())


def news_sentiment_check():
    _run_async(_news_sentiment_check_async())


def market_open_scan():
    _run_async(_market_open_scan_async())
