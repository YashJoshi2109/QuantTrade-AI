"""Outlook: option-implied math (checked against textbook Black-Scholes values),
hedge / scenario / earnings-move calculators, and the API with stubbed data."""
import math
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.option_greeks import bs_price, year_fraction
from app.services.outlook import earnings_moves as em
from app.services.outlook import hedge as hg
from app.services.outlook import options_math as om
from app.services.outlook import scenario as sc


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.services.redis_cache_service import cache_service
    cache_service._fallback.clear_prefix("outlook:")
    yield
    cache_service._fallback.clear_prefix("outlook:")


def N(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))


# ── Black-76 / Black-Scholes reference values ────────────────────────────────

def test_black_matches_textbook_black_scholes():
    # Hull: S=100, K=100, T=1, r=5%, sigma=20% -> call 10.4506, put 5.5735
    S, K, T, r, s = 100.0, 100.0, 1.0, 0.05, 0.2
    F = S * math.exp(r * T)
    assert math.exp(-r * T) * om.black_price(F, K, T, s, True) == pytest.approx(10.4506, abs=1e-4)
    assert math.exp(-r * T) * om.black_price(F, K, T, s, False) == pytest.approx(5.5735, abs=1e-4)
    # same as the existing spot-based pricer
    assert math.exp(-r * T) * om.black_price(F, 110, T, s, True) == pytest.approx(bs_price(S, 110, T, r, s, True), abs=1e-9)
    # risk-neutral P(S_T > K) = N(d2) = N(0.15) = 0.5596
    assert om.prob_above_flat(F, K, T, s) == pytest.approx(0.559618, abs=1e-5)


def test_black_iv_round_trip_and_bounds():
    F, T = 101.0, 0.25
    for k, sig in ((80, 0.35), (100, 0.2), (130, 0.45)):
        for call in (True, False):
            p = om.black_price(F, k, T, sig, call)
            assert om.black_iv(p, F, k, T, call) == pytest.approx(sig, abs=1e-5)
    # below intrinsic: no solution rather than a fake vol
    assert om.black_iv(5.0, 120.0, 100.0, 0.5, True) is None
    assert om.straddle_iv(2 * F * (2 * N(0.2 * math.sqrt(T) / 2) - 1), F, T) == pytest.approx(0.2, abs=1e-6)


# ── synthetic chains ─────────────────────────────────────────────────────────

NOW = datetime(2026, 11, 2, 15, 0, tzinfo=timezone.utc)
EXP = "2026-12-18"
S0, R = 100.0, 0.05


def _chain(vol=lambda k: 0.2, strikes=None, spread=0.02, spot=S0, q=0.0):
    t = year_fraction(EXP, NOW)
    strikes = strikes or [60 + 2.5 * i for i in range(33)]
    calls, puts = [], []
    for k in strikes:
        for is_call, out in ((True, calls), (False, puts)):
            mid = bs_price(spot, k, t, R, vol(k), is_call, q)
            out.append({"strike": k, "bid": round(mid * (1 - spread), 6), "ask": round(mid * (1 + spread), 6),
                        "last": mid, "volume": 10, "open_interest": 100})
    return calls, puts, t


def test_flat_vol_chain_recovers_forward_iv_probability_and_ranges():
    calls, puts, t = _chain()
    a = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    F = S0 * math.exp(R * t)
    assert a["forward"] == pytest.approx(F, rel=1e-4)
    assert a["forward_method"] == "put_call_parity"
    assert a["atm_iv"] == pytest.approx(0.2, abs=2e-3)
    assert a["quality"] == "good" and a["quote_basis"] == "mid"
    assert a["prob_above_spot"] == pytest.approx(om.prob_above_flat(F, S0, t, 0.2), abs=5e-3)
    # 80% range = lognormal quantiles F exp(-s^2 T/2 +/- 1.28155 s sqrt T)
    st = 0.2 * math.sqrt(t)
    lo = F * math.exp(-0.5 * st * st - 1.281552 * st)
    hi = F * math.exp(-0.5 * st * st + 1.281552 * st)
    assert a["range_80"][0] == pytest.approx(lo, rel=4e-3)
    assert a["range_80"][1] == pytest.approx(hi, rel=4e-3)
    assert a["one_sigma_pct"] == pytest.approx(st * 100, abs=0.05)
    # straddle at the strike nearest the forward; move = straddle * e^{rT}
    k = a["straddle"]["strike"]
    assert k == 100.0
    px = bs_price(S0, k, t, R, 0.2, True) + bs_price(S0, k, t, R, 0.2, False)
    assert a["straddle"]["price"] == pytest.approx(px, abs=1e-3)
    assert a["straddle"]["move_pct"] == pytest.approx(px * math.exp(R * t) / S0 * 100, abs=1e-3)
    p = om.probability(a, 110.0)
    assert p["prob_above"] == pytest.approx(om.prob_above_flat(F, 110.0, t, 0.2), abs=5e-3)
    assert p["prob_above"] + p["prob_below"] == pytest.approx(1.0)


def test_dividend_yield_is_absorbed_by_parity_forward():
    calls, puts, t = _chain(q=0.03)
    a = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    assert a["forward"] == pytest.approx(S0 * math.exp((R - 0.03) * t), rel=1e-4)
    assert a["atm_iv"] == pytest.approx(0.2, abs=2e-3)


def test_skewed_smile_probability_matches_breeden_litzenberger_of_chain():
    vol = lambda k: 0.2 + 0.4 * (100.0 - k) / 100.0  # noqa: E731 - put skew
    calls, puts, t = _chain(vol=vol, spread=0.0)
    a = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    # BL directly on the quoted (discounted) call prices around 100
    c = {x["strike"]: x["last"] for x in calls}
    bl = -math.exp(R * t) * (c[102.5] - c[97.5]) / 5.0
    assert om.probability(a, 100.0)["prob_above"] == pytest.approx(bl, abs=0.01)
    # put skew (vol falling with strike) fattens the left tail, so P(above ATM)
    # exceeds the flat-vol N(d2): P = N(d2) - vega * dsigma/dK with dsigma/dK < 0
    assert om.probability(a, 100.0)["prob_above"] > om.probability(a, 100.0)["flat_iv_prob_above"]


def test_illiquid_and_garbage_strikes_are_ignored():
    calls, puts, _ = _chain()
    base = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    junk_c = [*calls, {"strike": 101.0, "bid": 0, "ask": 9.0, "last": 40.0, "volume": 0, "open_interest": 0},
              {"strike": 103.0, "bid": 0.5, "ask": 6.0, "last": 3.0, "volume": 5, "open_interest": 5}]
    junk_p = [*puts, {"strike": 101.0, "bid": None, "ask": None, "last": 0.01, "volume": 0, "open_interest": 0}]
    a = om.analyse_expiry(junk_c, junk_p, S0, EXP, R, now=NOW)
    assert a["atm_iv"] == pytest.approx(base["atm_iv"], abs=1e-9)
    assert a["range_80"] == base["range_80"]
    assert om.liquid_mid({"bid": 0.5, "ask": 6.0}) is None
    assert om.liquid_mid({"bid": 0.01, "ask": 0.05}) == pytest.approx(0.03)


def test_thin_chain_falls_back_to_straddle_vol_and_last_trades():
    calls, puts, t = _chain(strikes=[100.0])
    a = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    assert a["smile_method"] == "straddle_flat" and a["quality"] == "thin"
    assert a["atm_iv"] == pytest.approx(0.2, abs=0.01)
    # markets closed: no bids/asks, only last trades
    calls, puts, _ = _chain()
    for x in calls + puts:
        x["bid"] = x["ask"] = 0
    b = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    assert b["quote_basis"] == "last" and b["quality"] == "thin"
    assert b["atm_iv"] == pytest.approx(0.2, abs=2e-3)
    assert om.analyse_expiry([], [], S0, EXP, R, now=NOW) is None


def test_event_move_from_term_structure():
    before = {"atm_iv": 0.30, "t_years": 10 / 365}
    after = {"atm_iv": 0.55, "t_years": 17 / 365}
    var_e = 0.55 ** 2 * 17 / 365 - 0.30 ** 2 * (17 / 365 - 1 / 252)
    assert om.event_move_pct(before, after) == pytest.approx(math.sqrt(var_e) * math.sqrt(2 / math.pi) * 100, abs=1e-3)
    assert om.event_move_pct(None, after) is None
    assert om.event_move_pct({"atm_iv": 0.9, "t_years": 0.01}, {"atm_iv": 0.2, "t_years": 0.05}) is None


def test_public_curve_density_integrates_to_about_one():
    calls, puts, _ = _chain()
    a = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    pub = om.public(a, curve_points=80)
    assert "_smile" not in pub and len(pub["smile"]) > 10
    pts = pub["curve"]
    area = sum(0.5 * (p0["density"] + p1["density"]) * (p1["price"] - p0["price"]) for p0, p1 in zip(pts, pts[1:]))
    assert area == pytest.approx(1.0, abs=0.02)


# ── hedge planner ────────────────────────────────────────────────────────────

def test_hedge_outcomes():
    out = hg.plan(spot=100, shares=200, put_strike=95, put_premium=2.0, call_strike=110, call_premium=1.5,
                  reduce_fraction=0.5)
    by = {s["id"]: s for s in out["strategies"]}
    assert out["position_value"] == 20000
    assert by["unhedged"]["max_loss"] == 20000 and by["unhedged"]["breakeven"] == 100
    put = by["protective_put"]
    assert put["upfront_cost"] == 400 and put["max_loss"] == (100 - 95 + 2) * 200 and put["breakeven"] == 102
    assert put["max_gain"] is None
    col = by["collar"]
    assert col["upfront_cost"] == pytest.approx(100)  # (2.0 - 1.5) * 200
    assert col["max_loss"] == pytest.approx((100 - 95 + 0.5) * 200)
    assert col["max_gain"] == pytest.approx((110 - 100 - 0.5) * 200)
    assert col["breakeven"] == pytest.approx(100.5)
    red = by["reduce"]
    assert red["max_loss"] == 10000 and red["upfront_cost"] == 0
    # payoff curve agrees with the formulas at the extremes
    low = out["curve"][0]
    assert low["price"] == 50
    assert low["protective_put"] == pytest.approx(-put["max_loss"])
    assert low["collar"] == pytest.approx(-col["max_loss"])
    high = out["curve"][-1]
    assert high["collar"] == pytest.approx(col["max_gain"])
    assert high["reduce"] == pytest.approx(50 * 100)
    with pytest.raises(ValueError):
        hg.plan(spot=0, shares=1)


def test_hedge_probability_hook_and_collar_requires_call_above_put():
    out = hg.plan(spot=100, shares=100, put_strike=95, put_premium=2, call_strike=90, call_premium=12,
                  prob_below=lambda x: 0.5 if x >= 100 else 0.3)
    ids = [s["id"] for s in out["strategies"]]
    assert "collar" not in ids
    assert {s["id"]: s for s in out["strategies"]}["protective_put"]["prob_below_breakeven"] == 0.5


# ── scenario planner ─────────────────────────────────────────────────────────

def test_beta_and_window_return():
    import random
    rnd = random.Random(7)
    m = [rnd.gauss(0, 0.01) for _ in range(250)]
    a = [1.5 * x + rnd.gauss(0, 0.002) for x in m]
    assert sc.beta(a, m) == pytest.approx(1.5, abs=0.05)
    assert sc.beta(a[:50], m[:50]) is None
    closes = {date(2020, 2, 19): 100.0, date(2020, 3, 2): 90.0, date(2020, 3, 23): 66.0}
    assert sc.window_return(closes, date(2020, 2, 19), date(2020, 3, 23)) == pytest.approx(-0.34)
    # listed mid-episode: not "actual"
    assert sc.window_return({date(2020, 3, 10): 50.0, date(2020, 3, 23): 40.0},
                            date(2020, 2, 19), date(2020, 3, 23)) is None


def test_apply_scenario_precedence_and_totals():
    hold = [{"symbol": "AAA", "shares": 10, "price": 100.0}, {"symbol": "BBB", "shares": 5, "price": 200.0},
            {"symbol": "CCC", "shares": 1, "price": 50.0}, {"symbol": "DDD", "shares": 1, "price": None},
            {"symbol": "EEE", "shares": 2, "price": 10.0}]
    out = sc.apply(hold, market_return=-0.2, symbol_returns={"AAA": -0.5}, betas={"BBB": 1.5, "EEE": 2.0},
                   overrides={"eee": -0.9})
    by = {h["symbol"]: h for h in out["holdings"]}
    assert by["AAA"]["method"] == "actual" and by["AAA"]["pnl"] == -500
    assert by["BBB"]["method"] == "beta" and by["BBB"]["pnl"] == pytest.approx(-300)
    assert by["CCC"]["method"] == "assumed_beta_1" and by["CCC"]["pnl"] == -10
    assert by["DDD"]["method"] == "no_price" and by["DDD"]["pnl"] is None
    assert by["EEE"]["method"] == "override" and by["EEE"]["pnl"] == pytest.approx(-18)
    assert out["total_value"] == 1000 + 1000 + 50 + 20
    assert out["total_pnl"] == pytest.approx(-500 - 300 - 10 - 18)
    # a long position cannot lose more than 100%
    worst = sc.apply([{"symbol": "X", "shares": 1, "price": 10.0}], market_return=-0.6, betas={"X": 3.0})
    assert worst["holdings"][0]["shock_pct"] == -100.0


# ── earnings realized moves ──────────────────────────────────────────────────

def test_realized_earnings_moves_by_timing():
    import pandas as pd
    closes = {date(2026, 1, 26): 100.0, date(2026, 1, 27): 110.0, date(2026, 1, 28): 99.0,
              date(2026, 4, 27): 50.0, date(2026, 4, 28): 47.0, date(2026, 4, 29): 48.0,
              date(2026, 7, 27): 80.0, date(2026, 7, 28): 81.0, date(2026, 7, 29): 84.0}
    stamps = [pd.Timestamp("2026-01-27 16:05", tz="America/New_York"),   # AMC: 27 -> 28
              pd.Timestamp("2026-04-28 07:00", tz="America/New_York"),   # BMO: 27 -> 28
              pd.Timestamp("2026-07-28"),                                # unknown: 27 -> 29
              pd.Timestamp("2026-12-01 16:00", tz="America/New_York")]   # future: skipped
    moves = em.realized_moves(closes, stamps, today=date(2026, 11, 27))
    by = {m["date"]: m for m in moves}
    assert by["2026-01-27"]["timing"] == "amc" and by["2026-01-27"]["move_pct"] == -10.0
    assert by["2026-04-28"]["timing"] == "bmo" and by["2026-04-28"]["move_pct"] == -6.0
    assert by["2026-07-28"]["timing"] == "unknown" and by["2026-07-28"]["move_pct"] == 5.0
    assert [m["date"] for m in moves] == ["2026-07-28", "2026-04-28", "2026-01-27"]
    s = em.summarize(moves)
    assert s["count"] == 3 and s["avg_abs_move_pct"] == 7.0 and s["median_abs_move_pct"] == 6.0
    assert s["up_count"] == 1
    assert em.summarize([])["avg_abs_move_pct"] is None


# ── API with stubbed loaders ─────────────────────────────────────────────────

@pytest.fixture()
def client(monkeypatch):
    from app.api import outlook
    from app.db.database import get_db

    today = date.today()
    # expiries every Friday for ~3 months
    d = today + timedelta(days=1)
    exps = []
    while len(exps) < 14:
        if d.weekday() == 4:
            exps.append(d.isoformat())
        d += timedelta(days=1)

    def chain_for(exp):
        t = year_fraction(exp)
        calls, puts = [], []
        for k in [60 + 2.5 * i for i in range(33)]:
            for is_call, out in ((True, calls), (False, puts)):
                mid = bs_price(S0, k, t, 0.043, 0.25, is_call)
                out.append({"strike": k, "bid": mid * 0.98, "ask": mid * 1.02, "last": mid, "volume": 1,
                            "open_interest": 1})
        return {"calls": calls, "puts": puts, "spot": S0, "source": "test"}

    async def load_expirations(sym):
        return exps if sym != "NOOPT" else []

    async def load_chain(sym, exp):
        return chain_for(exp)

    async def load_closes(sym, start=None, end=None, period="2y"):
        import random
        rnd = random.Random(hash(sym) % 1000)
        if start:  # historical window: SPY -30%, AAA -50%, BBB not listed
            s, e = date.fromisoformat(start), date.fromisoformat(end)
            if sym == "BBB":
                return {}
            drop = {"SPY": 0.7, "AAA": 0.5}.get(sym, 0.8)
            return {s + timedelta(days=10): 100.0, e - timedelta(days=10): 100.0 * drop}
        px, out, day = 100.0, {}, today - timedelta(days=400)
        for _ in range(260):
            day += timedelta(days=1)
            px *= 1 + rnd.gauss(0, 0.01)
            out[day] = px
        return out

    async def load_next_earnings(sym, horizon_days=45):
        if sym == "AAPL":
            return {"date": exps[2], "hour": "amc", "fiscal_period": "Q1", "eps_estimate": 2.1}
        return None

    async def load_earnings_stamps(sym):
        return []

    async def load_dividend_histories(syms):
        return {s: ({"dividends": [["2026-05-10", 0.25], ["2026-08-10", 0.26]], "next_ex_date": exps[1],
                     "next_pay_date": exps[3]} if s == "AAPL" else None) for s in syms}

    async def load_macro(start, end):
        return [{"date": exps[0], "time": "08:30", "name": "CPI YoY", "forecast": "3.0", "prior": "3.1",
                 "unit": "%"}]

    async def load_forecast(sym):
        last = date.today()
        path = []
        for k in range(1, 61):
            path.append({"h": k, "date": (last + timedelta(days=k)).isoformat(), "point": 100.5,
                         "exp_return_pct": 0.5, "prob_up": 0.52,
                         "bands": {"50": [95.0, 105.0], "80": [90.0, 110.0], "95": [85.0, 115.0]}})
        return {"as_of": last.isoformat(), "last_close": 100.0, "path": path, "model": {"name": "SARIMAX(1,0,1)"},
                "vol_annualized_pct": 24.0, "beats_naive": {"1": False}, "disclaimer": "x"}

    async def load_quotes(syms):
        return {s: (100.0, "quote") for s in syms if s != "ZZZ"}

    for name, fn in dict(load_expirations=load_expirations, load_chain=load_chain, load_closes=load_closes,
                         load_next_earnings=load_next_earnings, load_earnings_stamps=load_earnings_stamps,
                         load_dividend_histories=load_dividend_histories, load_macro=load_macro,
                         load_forecast=load_forecast, load_quotes=load_quotes).items():
        monkeypatch.setattr(outlook, name, fn)
    app = FastAPI()
    app.include_router(outlook.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: None
    c = TestClient(app)
    c.exps = exps
    return c


def test_api_implied(client):
    r = client.get("/api/v1/outlook/AAPL/implied")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["spot"] == S0 and 1 <= len(body["expiries"]) <= 8
    first = body["expiries"][0]
    assert first["atm_iv"] == pytest.approx(0.25, abs=3e-3)
    assert first["range_80"][0] < S0 < first["range_80"][1]
    assert "_smile" not in first and "educational" in body["disclaimer"].lower()
    assert client.get("/api/v1/outlook/NOOPT/implied").status_code == 404
    assert client.get("/api/v1/outlook/bad$sym/implied").status_code == 422


def test_api_probability(client):
    exp = client.exps[5]
    r = client.get(f"/api/v1/outlook/AAPL/probability?target=110&expiration={exp}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expiration"] == exp
    t = year_fraction(exp)
    F = S0 * math.exp(0.043 * t)
    assert body["probability"]["prob_above"] == pytest.approx(om.prob_above_flat(F, 110, t, 0.25), abs=6e-3)
    assert len(body["expiry"]["curve"]) >= 40
    # a date between expiries snaps to the next listed expiry
    mid = (date.fromisoformat(client.exps[5]) - timedelta(days=2)).isoformat()
    assert client.get(f"/api/v1/outlook/AAPL/probability?target=110&expiration={mid}").json()["expiration"] == exp
    assert client.get(f"/api/v1/outlook/AAPL/probability?target=100000&expiration={exp}").status_code == 422


def test_api_hedge(client):
    r = client.post("/api/v1/outlook/hedge", json={"symbol": "AAPL", "shares": 100})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] >= 28
    assert body["put"]["strike"] == 95.0 and body["call"]["strike"] == 105.0
    by = {s["id"]: s for s in body["strategies"]}
    p = body["put"]["premium"]
    assert by["protective_put"]["max_loss"] == pytest.approx((100 - 95 + p) * 100, abs=0.01)
    assert 0 < by["protective_put"]["prob_below_breakeven"] < 1
    r2 = client.post("/api/v1/outlook/hedge", json={"symbol": "AAPL", "shares": 100, "put_strike": 90,
                                                     "call_strike": 115, "reduce_pct": 25,
                                                     "expiration": body["expiration"]})
    assert r2.status_code == 200 and r2.json()["put"]["strike"] == 90.0
    assert client.post("/api/v1/outlook/hedge", json={"symbol": "AAPL", "shares": 100,
                                                      "put_strike": 91.3}).status_code == 422


def test_api_scenarios(client):
    assert any(s["id"] == "covid_2020" for s in client.get("/api/v1/outlook/scenarios").json()["scenarios"])
    hold = [{"symbol": "AAA", "shares": 10}, {"symbol": "BBB", "shares": 10}, {"symbol": "ZZZ", "shares": 1}]
    r = client.post("/api/v1/outlook/scenario", json={"holdings": hold, "scenario_id": "covid_2020"})
    assert r.status_code == 200, r.text
    by = {h["symbol"]: h for h in r.json()["holdings"]}
    assert by["AAA"]["method"] == "actual" and by["AAA"]["shock_pct"] == -50.0
    assert by["BBB"]["method"] in ("beta", "assumed_beta_1")
    assert by["ZZZ"]["method"] == "no_price"
    assert r.json()["market_return_pct"] == -30.0
    r = client.post("/api/v1/outlook/scenario", json={"holdings": hold, "market_move_pct": -10,
                                                      "overrides": {"AAA": 5}})
    assert {h["symbol"]: h for h in r.json()["holdings"]}["AAA"]["shock_pct"] == 5.0
    assert client.post("/api/v1/outlook/scenario", json={"holdings": hold}).status_code == 422
    assert client.post("/api/v1/outlook/scenario", json={"holdings": hold, "scenario_id": "nope"}).status_code == 422


def test_api_calendar_and_earnings_and_perception(client):
    r = client.get("/api/v1/outlook/calendar?symbols=AAPL,SPY")
    assert r.status_code == 200, r.text
    ev = r.json()["events"]
    kinds = {e["type"] for e in ev}
    assert kinds == {"earnings", "dividend", "macro"}
    earn = next(e for e in ev if e["type"] == "earnings")
    # flat 25% term structure: the event day carries only one ordinary day of variance
    assert earn["implied"]["move_pct"] > 0
    assert earn["implied"]["event_move_pct"] == pytest.approx(0.25 / math.sqrt(252) * math.sqrt(2 / math.pi) * 100,
                                                              abs=0.05)
    div = next(e for e in ev if e["type"] == "dividend")
    assert div["amount"] == 0.26 and div["amount_pct"] == pytest.approx(0.26, abs=1e-3)
    assert [e["date"] for e in ev] == sorted(e["date"] for e in ev)

    e = client.get("/api/v1/outlook/AAPL/earnings").json()
    assert e["implied"]["expiration"] > e["next_earnings"]["date"]  # AMC: first expiry after the report day
    assert e["summary"]["count"] == 0 and e["implied_vs_realized"] is None

    p = client.get("/api/v1/outlook/AAPL/perception")
    assert p.status_code == 200, p.text
    rows = p.json()["rows"]
    assert rows and all(r["market"]["range_80"][0] < 100 < r["market"]["range_80"][1] for r in rows)
    assert rows[0]["model"]["range_80"] == [90.0, 110.0]
    assert "risk-neutral" in p.json()["labels"]["market"]


def test_select_expiries():
    from app.api.outlook import select_expiries
    today = date(2026, 11, 27)
    exps = ["2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18", "2026-12-24", "2026-12-31",
            "2027-01-08", "2027-01-15", "2027-01-22", "2027-02-19", "2027-03-19", "2027-06-18"]
    got = select_expiries(exps, today, 8)
    assert got[:4] == ["2026-12-04", "2026-12-11", "2026-12-18", "2026-12-24"]
    assert "2027-01-15" in got and "2027-02-19" in got and "2026-11-27" not in got


# ── robustness on real-world quotes ──────────────────────────────────────────

def test_noisy_smile_does_not_create_probability_cliffs():
    # +/-1.5 vol points of alternating quote noise on a flat 20% smile (as seen on
    # live chains): the smooth fit must keep P(above) close to the flat-vol value
    calls, puts, t = _chain(vol=lambda k: 0.2 + (0.015 if int(k / 2.5) % 2 else -0.015))
    a = om.analyse_expiry(calls, puts, S0, EXP, R, now=NOW)
    F = a["forward"]
    assert om.probability(a, F)["prob_above"] == pytest.approx(om.prob_above_flat(F, F, t, 0.2), abs=0.03)
    probs = [p for _, p in a["_dist"]]
    assert all(p0 >= p1 for p0, p1 in zip(probs, probs[1:]))
    assert max(p0 - p1 for p0, p1 in zip(probs, probs[1:])) < 0.05
    assert a["range_68"][0] < a["spot"] < a["range_68"][1]


def test_isotonic_keeps_one_low_point_local():
    out = om._isotonic_decreasing([1.0, 0.9, 0.2, 0.8, 0.7, 0.1])
    assert all(x >= y for x, y in zip(out, out[1:]))
    assert out[0] == 1.0 and out[-1] == pytest.approx(0.1)
    assert out[3] > 0.4  # a running minimum would have pinned it at 0.2


def test_smile_fit_is_exact_for_a_quadratic_and_concave_falls_back_to_linear():
    ks = [-0.2, -0.1, 0.0, 0.1, 0.2]
    a, b, c = om.fit_smile(ks, [0.2 - 0.3 * k + 0.5 * k * k for k in ks], 0.25)
    assert (a, b, c) == pytest.approx((0.2, -0.3, 0.5), abs=1e-9)
    a, b, c = om.fit_smile(ks, [0.2 - 0.5 * k * k for k in ks], 0.25)
    assert c == 0.0


def test_api_reanchors_a_stale_quoted_price_on_option_parity(client, monkeypatch):
    from app.api import outlook
    real = outlook.load_chain

    async def stale(sym, exp):
        ch = await real(sym, exp)
        return {**ch, "spot": 96.0}  # quote 4% below where the options are priced

    monkeypatch.setattr(outlook, "load_chain", stale)
    body = client.get("/api/v1/outlook/AAPL/implied").json()
    assert body["spot_basis"] == "option_parity" and body["quoted_spot"] == 96.0
    assert body["spot"] == pytest.approx(S0, rel=2e-3)
    assert body["expiries"][0]["prob_above_spot"] == pytest.approx(0.5, abs=0.06)
    h = client.post("/api/v1/outlook/hedge", json={"symbol": "AAPL", "shares": 10}).json()
    assert h["spot_basis"] == "option_parity" and h["spot"] == pytest.approx(S0, rel=2e-3)
