"""Black-Scholes Greeks / IV against textbook values (Hull, Options Futures and
Other Derivatives: S=49, K=50, r=5%, sigma=20%, T=0.3846)."""
from datetime import datetime, timezone

import pytest

from app.services.option_greeks import (
    bs_greeks,
    bs_price,
    enrich_contracts,
    implied_volatility,
    year_fraction,
)

S, K, R, SIG, T = 49.0, 50.0, 0.05, 0.20, 0.3846


def test_call_price_matches_hull():
    assert bs_price(S, K, T, R, SIG, True) == pytest.approx(2.40, abs=0.01)


def test_put_call_parity():
    import math

    c = bs_price(S, K, T, R, SIG, True)
    p = bs_price(S, K, T, R, SIG, False)
    assert c - p == pytest.approx(S - K * math.exp(-R * T), abs=1e-9)


def test_call_greeks_match_hull():
    g = bs_greeks(S, K, T, R, SIG, True)
    assert g["delta"] == pytest.approx(0.522, abs=0.001)
    assert g["gamma"] == pytest.approx(0.066, abs=0.001)
    # Hull: annual theta -4.31 -> per day /365
    assert g["theta"] == pytest.approx(-4.31 / 365, abs=0.0005)
    # Hull: vega 12.1 per unit vol -> per vol point /100
    assert g["vega"] == pytest.approx(0.121, abs=0.001)
    # Hull: rho 8.91 per unit rate -> per 1% /100
    assert g["rho"] == pytest.approx(0.0891, abs=0.0005)


def test_put_greeks():
    call = bs_greeks(S, K, T, R, SIG, True)
    put = bs_greeks(S, K, T, R, SIG, False)
    assert put["delta"] == pytest.approx(call["delta"] - 1, abs=1e-9)
    assert put["gamma"] == pytest.approx(call["gamma"], abs=1e-12)
    assert put["vega"] == pytest.approx(call["vega"], abs=1e-12)
    assert put["rho"] < 0


def test_implied_vol_round_trip():
    price = bs_price(S, K, T, R, 0.35, False)
    assert implied_volatility(price, S, K, T, R, False) == pytest.approx(0.35, abs=1e-4)


def test_implied_vol_rejects_below_intrinsic():
    # Deep ITM call quoted below intrinsic value has no solution.
    assert implied_volatility(5.0, 100.0, 80.0, 0.1, 0.05, True) is None


def test_year_fraction_floor_and_value():
    now = datetime(2026, 11, 25, 21, 0, tzinfo=timezone.utc)
    assert year_fraction("2026-11-25", now) == pytest.approx(1 / (365 * 24))
    assert year_fraction("2026-12-02", now) == pytest.approx(7 / 365)


def test_enrich_fills_missing_fields_only():
    now = datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc)
    rows = [
        {"strike": 100.0, "bid": 2.0, "ask": 2.2, "mid": None, "last": 2.1,
         "implied_volatility": None, "delta": None, "gamma": None,
         "theta": None, "vega": None, "rho": None},
        {"strike": 105.0, "bid": 0.5, "ask": 0.6, "mid": None, "last": None,
         "implied_volatility": 0.3, "delta": 0.99, "gamma": None,
         "theta": None, "vega": None, "rho": None},
    ]
    enrich_contracts(rows, spot=100.0, expiration="2026-12-18", is_call=True, r=0.043, now=now)
    a, b = rows
    assert a["mid"] == 2.1
    assert 0.1 < a["implied_volatility"] < 0.5
    assert 0.4 < a["delta"] < 0.6
    assert a["theta"] < 0 and a["gamma"] > 0 and a["vega"] > 0
    # provider values preserved
    assert b["implied_volatility"] == 0.3
    assert b["delta"] == 0.99
    assert b["gamma"] is not None


def test_enrich_borrows_nearest_iv_for_unsolvable_deep_itm():
    now = datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc)
    rows = [
        # quoted below intrinsic (100 - 60 = 40): no IV solves
        {"strike": 60.0, "bid": 38.0, "ask": 39.0, "mid": None, "implied_volatility": None,
         "delta": None, "gamma": None, "theta": None, "vega": None, "rho": None},
        {"strike": 100.0, "bid": 2.0, "ask": 2.2, "mid": None, "implied_volatility": None,
         "delta": None, "gamma": None, "theta": None, "vega": None, "rho": None},
    ]
    enrich_contracts(rows, spot=100.0, expiration="2026-12-18", is_call=True, r=0.043, now=now)
    deep = rows[0]
    assert deep["implied_volatility"] is None
    assert deep["delta"] == pytest.approx(1.0, abs=0.01)


def test_enrich_without_spot_only_sets_mid():
    rows = [{"strike": 100.0, "bid": 1.0, "ask": 1.5, "mid": None,
             "implied_volatility": None, "delta": None}]
    enrich_contracts(rows, spot=None, expiration="2026-12-18", is_call=False)
    assert rows[0]["mid"] == 1.25
    assert rows[0]["delta"] is None
