"""Ticker lifecycle: audit classifier, migration idempotency, null-bar
filtering, inactive exclusion from universes, sanity + forecast refusal."""
from datetime import date, datetime, timezone
from pathlib import Path

import math
import pandas as pd
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.models.price import PriceBar
from app.models.symbol import Symbol, ensure_symbol_lifecycle_columns
from app.services import ticker_lifecycle as tl
from app.services.ticker_audit import (
    GONE, OK, RENAMED, REUSED, STALE, UNKNOWN, Evidence, classify, collect_code_universe, completeness,
    _extract_py, _extract_ts,
)

REPO = Path(__file__).resolve().parents[2]
TODAY = date(2026, 11, 27)


@pytest.fixture(autouse=True)
def _fresh_cache():
    tl.reset_cache()
    yield
    tl.reset_cache()


# ── classifier ─────────────────────────────────────────────────────────────

def _ev(t="AAPL", **kw):
    base = dict(listed_name="Apple Inc", sec_name="Apple Inc.", last_bar=date(2026, 11, 26), bar_source="yfinance")
    base.update(kw)
    return Evidence(t, **base)


def test_classify_ok_when_recent_bar():
    v = classify(_ev(), today=TODAY)
    assert v.status == OK and not v.name_mismatch


def test_classify_stale_after_ten_sessions():
    v = classify(_ev(last_bar=date(2026, 11, 6)), today=TODAY)  # 15 weekdays ago
    assert v.status == STALE
    assert v.sessions_since_bar > 10


def test_classify_renamed_and_acquired_from_lifecycle():
    v = classify(_ev("SQ", last_bar=None, sec_name=None), today=TODAY, retirement=tl.retirement("SQ"))
    assert v.status == RENAMED and v.successor == "XYZ"
    v = classify(_ev("PXD", last_bar=None, sec_name=None), today=TODAY, retirement=tl.retirement("PXD"))
    assert v.status == GONE and v.successor == "XOM"
    v = classify(_ev("MMC", last_bar=None, sec_name=None), today=TODAY, retirement=tl.retirement("MMC"))
    assert v.status == RENAMED and v.successor == "MRSH"


def test_classify_reused_ticker():
    v = classify(_ev("PARA", listed_name="Paramount Global", sec_name="Parabolic Technologies, Inc."),
                 today=TODAY, retirement=tl.retirement("PARA"))
    assert v.status == REUSED and v.successor == "SKYD"
    assert v.name_mismatch


def test_classify_unknown_without_any_data_but_in_sec():
    v = classify(_ev("ZZZ", last_bar=None, quote_price=None, sec_name="Zzz Corp"), today=TODAY)
    assert v.status == UNKNOWN


def test_classify_gone_when_no_data_and_not_in_sec():
    v = classify(_ev("ZZZ", last_bar=None, quote_price=None, sec_name=None), today=TODAY)
    assert v.status == GONE


def test_classify_flags_name_mismatch_on_trading_ticker():
    # SATS-like: the name we show disagrees with SEC's holder.
    v = classify(_ev("ABCD", listed_name="EchoStar Corp", sec_name="Strive, Inc."), today=TODAY)
    assert v.status == OK and v.name_mismatch
    assert "SEC holder" in v.reason


def test_inventory_extraction_reads_curated_lists():
    src = 'X = {"Tech": [("AAPL", "Apple Inc"), ("ACM", "AECOM")]}\nY = {"DEU": ["SAP"]}\n'
    assert _extract_py(src, ("X",)) == ["Tech", "AAPL", "ACM"]
    ts = "const P = { 'FAANG+': ['AAPL', 'META'] }\nconst Q = [{ symbol: 'VAL.JO', name: 'Valterra' }]"
    assert {"AAPL", "META"} <= set(_extract_ts(ts, ("P",)))
    assert _extract_ts(ts, ("Q",)) == ["VAL.JO"]


def test_code_universe_has_no_retired_tickers():
    universe = collect_code_universe(REPO)
    assert len(universe) > 500
    leftover = sorted(t for t in universe if tl.excluded_from_curated(t))
    assert leftover == []


def test_completeness_scores_and_not_applicable():
    q = {"last_price": 10, "previous_close": 9.5, "volume": 100}
    f = {"company_name": "X", "sector": "Tech", "market_cap": 1e9, "pe_ratio": None, "week_52_high": 12,
         "field_notes": {"pe_ratio": {"status": "n/m"}}}
    ind = {"indicators": {"sma_20": 1, "sma_50": 1, "sma_200": 1, "rsi": 50, "macd": {"macd": 0.1}}}
    bars = [{"close": 1}] * 260
    score, missing, na = completeness("X", q, f, ind, bars, {"edgar_status": "ok", "exchange": "NASDAQ"}, [1])
    assert score == 100.0 and missing == [] and "pe" in na
    score, missing, _ = completeness("X", q, {**f, "market_cap": None}, ind, bars[:20], None, [])
    assert {"market_cap", "range_52w_250", "sec_filings", "news"} <= set(missing)
    assert score < 100


# ── lifecycle columns migration ───────────────────────────────────────────

def _legacy_engine():
    """A symbols table as it existed before the lifecycle columns."""
    eng = create_engine("sqlite://")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE symbols (id INTEGER PRIMARY KEY, symbol VARCHAR(10) UNIQUE NOT NULL, "
                       "name VARCHAR(255), exchange VARCHAR(50), asset_type VARCHAR(50), currency VARCHAR(10), "
                       "country VARCHAR(50), sector VARCHAR(100), industry VARCHAR(100), market_cap FLOAT, "
                       "created_at DATETIME, updated_at DATETIME)"))
        c.execute(text("INSERT INTO symbols (symbol, name) VALUES ('SQ', 'Block Inc'), ('AAPL', 'Apple Inc'), "
                       "('PARA', 'Paramount Global')"))
    return eng


def test_migration_adds_columns_and_is_idempotent():
    import runpy

    eng = _legacy_engine()
    mod = runpy.run_path(str(REPO / "backend/scripts/add_symbol_lifecycle_columns.py"))
    first = mod["migrate"](engine=eng, session_factory=sessionmaker(bind=eng))
    assert set(first["added"]) == {"is_active", "delisted_at", "successor_symbol", "status_note"}
    assert first["changed"] == 2  # SQ retired, PARA reused
    second = mod["migrate"](engine=eng, session_factory=sessionmaker(bind=eng))
    assert second["added"] == [] and second["changed"] == 0 and second["unchanged"] == 2
    cols = {c["name"] for c in inspect(eng).get_columns("symbols")}
    assert {"is_active", "delisted_at", "successor_symbol", "status_note"} <= cols
    db = sessionmaker(bind=eng)()
    sq = db.query(Symbol).filter(Symbol.symbol == "SQ").one()
    assert sq.is_active is False and sq.successor_symbol == "XYZ" and sq.delisted_at == date(2025, 1, 17)
    para = db.query(Symbol).filter(Symbol.symbol == "PARA").one()
    assert para.is_active is True and para.successor_symbol == "SKYD"
    assert para.name == "Parabolic Technologies, Inc."
    assert db.query(Symbol).count() == 3  # never deletes, never creates
    aapl = db.query(Symbol).filter(Symbol.symbol == "AAPL").one()
    assert aapl.is_active in (None, True)


def test_create_all_includes_lifecycle_columns():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[Symbol.__table__])
    cols = {c["name"] for c in inspect(eng).get_columns("symbols")}
    assert {"is_active", "delisted_at", "successor_symbol", "status_note"} <= cols
    assert ensure_symbol_lifecycle_columns(eng) == []


# ── null-bar filtering ────────────────────────────────────────────────────

def test_clean_bar_dicts_drops_null_close_and_fills_ohlc():
    from app.services.bar_hygiene import clean_bar_dicts

    bars = [
        {"timestamp": 1, "open": None, "high": None, "low": None, "close": None, "volume": 0},
        {"timestamp": 2, "open": float("nan"), "high": None, "low": 2.0, "close": 3.0, "volume": None},
        {"timestamp": 3, "open": 2.5, "high": 2.0, "low": 2.6, "close": 2.7, "volume": 5},
    ]
    out = clean_bar_dicts(bars)
    assert [b["timestamp"] for b in out] == [2, 3]
    assert out[0] == {"timestamp": 2, "open": 3.0, "high": 3.0, "low": 2.0, "close": 3.0, "volume": 0}
    assert out[1]["high"] == 2.7 and out[1]["low"] == 2.5  # widened to contain open/close


def test_clean_ohlcv_df_and_split_breaks():
    from app.services.bar_hygiene import clean_ohlcv_df, clean_tail_start, split_breaks

    df = pd.DataFrame({"open": [1, None, 1], "high": [1, None, 1.2], "low": [1, None, 0.9],
                       "close": [1.0, float("nan"), 1.1], "volume": [1, 0, 1]})
    assert len(clean_ohlcv_df(df)) == 2
    closes = [0.12, 0.10, 0.06, 0.028, 3.04, 2.8, 2.74]  # PARA, 2026-11: unadjusted reverse split
    assert split_breaks(closes) == [4]
    assert clean_tail_start(closes) == 4
    assert split_breaks([10, 11, 9.5, 12]) == []


class _FakeDb:
    commits = 0

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def _para_bars():
    """Stored PARA bars as prod had them: the 2026-11-23 session is NaN (JSON null)."""
    from types import SimpleNamespace

    nan = float("nan")
    return [SimpleNamespace(timestamp=datetime(2026, 11, d, 5), open=c, high=c, low=c, close=c,
                            volume=0 if c != c else 100)
            for d, c in ((20, 0.028), (23, nan), (24, 3.04), (25, 2.8))]


def test_prices_endpoint_never_emits_null_bars(monkeypatch):
    from app.api import prices as prices_api
    from app.services import bar_hygiene

    monkeypatch.setattr(bar_hygiene, "sip_bars_by_date", lambda s, days: {})
    prices_api._last_sync_attempt.clear()
    out = prices_api._clean_response_bars(_FakeDb(), "PARA", _para_bars())
    assert [b.close for b in out] == [0.028, 3.04, 2.8]
    assert all(b.open is not None and not math.isnan(b.close) for b in out)


def test_prices_endpoint_repairs_null_bar_from_sip(monkeypatch):
    from app.api import prices as prices_api
    from app.services import bar_hygiene

    monkeypatch.setattr(bar_hygiene, "sip_bars_by_date",
                        lambda s, days: {date(2026, 11, 23): (2.59, 3.3, 2.06, 2.9, 504800.0)})
    prices_api._last_sync_attempt.clear()
    db, bars = _FakeDb(), _para_bars()
    out = prices_api._clean_response_bars(db, "PARA", bars)
    assert [b.close for b in out] == [0.028, 2.9, 3.04, 2.8]
    assert bars[1].close == 2.9 and bars[1].volume == 504800 and db.commits == 1  # stored row fixed


def test_get_prices_route_uses_clean_path():
    """The route returns through _clean_response_bars on every exit."""
    import inspect as _inspect
    from app.api import prices as prices_api

    src = _inspect.getsource(prices_api.get_prices)
    assert src.count("return _clean_response_bars(") == 2 and "return bars" not in src


def test_indicators_restart_after_split_and_ignore_null_bars():
    from app.services.indicators import IndicatorService

    closes = [0.1 + 0.001 * i for i in range(250)] + [3.0 + 0.01 * i for i in range(30)]
    df = pd.DataFrame({"open": closes, "high": closes, "low": closes, "close": closes, "volume": 1})
    df.loc[100, "close"] = float("nan")
    out = IndicatorService.indicators_from_df(df, "test")
    assert out["bars_used"] == 30
    assert out["sma_20"] is not None and out["sma_50"] is None and out["sma_200"] is None
    assert out["rsi"] is not None and out["sma_20"] > 3


def test_best_indicators_prefers_full_coverage():
    from app.api.indicators import best_indicators

    calls = []
    part = {"sma_20": 1, "sma_50": 1, "sma_200": None, "rsi": 1, "macd": {"macd": 1}}
    full = {**part, "sma_200": 2}
    out = best_indicators([lambda: calls.append(1) or part, lambda: calls.append(2) or full,
                           lambda: calls.append(3) or full])
    assert out is full and calls == [1, 2]


# ── inactive exclusion ────────────────────────────────────────────────────

def test_market_universe_excludes_retired():
    from app.api.market import _flatten_sp500_symbol_rows

    syms = {s for s, _, _ in _flatten_sp500_symbol_rows()}
    assert not syms & set(tl.RETIREMENTS)
    assert "AAPL" in syms


def test_model_index_universe_excludes_retired():
    from app.services.model_index.config import CURATED_UNIVERSE, get_full_universe

    flat = {t for v in CURATED_UNIVERSE.values() for t in v}
    assert not {"SQ", "PXD", "HES", "MMC"} & flat
    assert {"XYZ", "MRSH"} <= flat
    assert not set(get_full_universe()) & set(tl.RETIREMENTS)


def test_drop_inactive_uses_db_flags():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng, tables=[Symbol.__table__])
    db = sessionmaker(bind=eng)()
    db.add_all([Symbol(symbol="OLDCO", name="Old", is_active=False), Symbol(symbol="NEWCO", name="New")])
    db.commit()
    tl.reset_cache()
    out = tl.drop_inactive(["SQ", "OLDCO", "NEWCO", "AAPL", "PARA"], db=db)
    assert out == ["NEWCO", "AAPL", "PARA"]  # reused PARA still trades (Parabolic)
    q = tl.active_filter(db.query(Symbol.symbol), Symbol)
    assert {s for (s,) in q} == {"NEWCO"}


def test_alert_suggestions_and_calendars_skip_retired():
    from app.services.alert_suggestions import Suggestion, finalize
    from app.services.earnings_calendar import parse_nasdaq_earnings

    s = Suggestion(symbol="SQ", condition="price_above", threshold=100.0, reason="r", source="watchlist",
                   label="l", current_price=80.0, score=1.0)
    assert finalize([s], []) == []
    rows = parse_nasdaq_earnings({"data": {"rows": [{"symbol": "HES"}, {"symbol": "AAPL"}]}}, "2026-11-28")
    assert [r["symbol"] for r in rows] == ["AAPL"]


def test_lifecycle_payload_and_quote_error():
    from fastapi import HTTPException

    life = tl.lifecycle_payload("SQ")
    assert life["lifecycle_status"] == "inactive" and life["successor_symbol"] == "XYZ"
    assert tl.lifecycle_payload("PARA")["data_quality"] == "limited"
    assert tl.lifecycle_payload("AAPL")["lifecycle_status"] == "active"
    err = tl.inactive_quote_error("SQ")
    assert isinstance(err, HTTPException) and err.status_code == 410
    assert err.detail["status"] == "inactive" and "XYZ" in err.detail["message"]
    assert tl.inactive_quote_error("PARA") is None and tl.inactive_quote_error("AAPL") is None


def test_identity_knows_lifecycle_retirements():
    from app.services.instrument_identity import ticker_identity

    out = ticker_identity("PXD", "Pioneer Natural Resources", None)
    assert out["status"] == "changed" and out["successor_symbol"] == "XOM"
    out = ticker_identity("K", "Kellanova", None)
    assert out["status"] == "changed" and out["successor_symbol"] is None


# ── fundamentals sanity + forecast refusal ───────────────────────────────

def test_fundamental_sanity_rejects_para_values():
    from app.services.fundamental_sanity import sanitize

    f = {"week_52_high": 39200.0, "week_52_low": 2.06, "eps": 25891.0, "roe": -250.06, "pe_ratio": 0.0001,
         "target_price": 24000.0, "beta": -1.0, "market_cap": 1863780.0}
    out = sanitize(f, 2.74)
    for k in ("week_52_high", "eps", "roe", "pe_ratio", "target_price"):
        assert out[k] is None and out["field_notes"][k]["status"] == "implausible"
    assert out["week_52_low"] == 2.06 and out["market_cap"] == 1863780.0
    ok = sanitize({"week_52_high": 260.0, "week_52_low": 160.0, "eps": 6.5, "roe": 150.0}, 230.0)
    assert ok["field_notes"] == {} and ok["eps"] == 6.5


def test_fill_missing_derives_market_cap_and_pe():
    from app.services.fundamental_sanity import fill_missing, sec_ttm_eps_and_shares

    class R:
        def __init__(self, q, end, eps, shares):
            self.fiscal_quarter, self.period_end_date = q, end
            self.eps_diluted, self.shares_diluted, self.shares_basic, self.period = eps, shares, None, end

    rows = [R(3, "2026-09-30", '{"value": 1.0}', '{"value": 1000}'), R(2, "2026-06-30", '{"value": 1.0}', None),
            R(1, "2026-03-31", '{"value": 0.5}', None), R(4, "2025-12-31", '{"value": 0.5}', None)]
    eps, shares, src = sec_ttm_eps_and_shares(rows)
    assert eps == 3.0 and shares == 1000 and "4 quarterly" in src
    out = fill_missing({"market_cap": None, "pe_ratio": None}, 30.0, ttm_eps=eps, shares=shares, eps_source=src)
    assert out["market_cap"] == 30000 and out["pe_ratio"] == 10.0
    assert out["field_notes"]["market_cap"]["status"] == "derived"
    loss = fill_missing({"pe_ratio": None}, 30.0, ttm_eps=-1.0)
    assert loss["pe_ratio"] is None and loss["field_notes"]["pe_ratio"]["status"] == "n/m"


def test_forecast_refuses_split_jumps_and_retired():
    from app.api.forecast import forecast_history_problem

    idx = pd.bdate_range("2025-01-01", periods=600)
    clean = pd.Series([100 + i * 0.1 for i in range(600)], index=idx)
    assert forecast_history_problem("AAPL", clean) is None
    jumpy = clean.copy()
    jumpy.iloc[550:] = jumpy.iloc[550:] * 100
    msg = forecast_history_problem("ZZZ", jumpy)
    assert msg and "unadjusted split" in msg
    assert "no longer trades" in forecast_history_problem("SQ", clean)
    assert "reassigned" in forecast_history_problem("PARA", clean)
