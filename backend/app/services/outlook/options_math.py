"""Market-implied outlook from one option-chain expiry.

Everything here is pure math (stdlib only) over the contract dicts returned by
/api/v1/options/{symbol}/chain, so it is cheap and unit-tested against
textbook Black-Scholes values.

Method
------
1. Quotes. A contract is *liquid* when it has a two-sided market whose spread
   is at most half its mid (or 5 cents). Only liquid mids are used. When an
   expiry has too few liquid quotes (markets closed, thin names) we fall back
   to last trade prices of contracts that actually traded and say so in
   ``quote_basis``.
2. Forward. Put-call parity on the strikes nearest the money:
   F = K + e^{rT} (C - P). This absorbs dividends and borrow without needing
   a dividend forecast. Falls back to S e^{rT} when no strike has both sides.
3. Smile. Black-76 implied vol of the out-of-the-money side at each strike
   (calls at K >= F, puts below), smoothed by a weighted least-squares
   quadratic in log-moneyness (near-the-money strikes weigh most) and held
   flat beyond the last quoted strike. Exact interpolation would turn the
   strike-to-strike quote noise into wild swings in probability.
4. Risk-neutral probabilities by Breeden-Litzenberger: P(S_T > K) is minus the
   strike derivative of the undiscounted call price built from that smile. The
   resulting curve is made non-increasing by isotonic regression (pool
   adjacent violators) and clipped to [0, 1], so no strike region can carry
   negative probability.
5. Implied move. The at-the-money straddle (strike nearest the forward):
   straddle * e^{rT} = E|S_T - K| under the pricing measure, i.e. the expected
   absolute move to expiry.

Risk-neutral probabilities are what option prices imply, not a forecast of
real-world odds: they include the premium investors pay for protection.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

MAX_REL_SPREAD = 0.5      # spread / mid above this is not a usable quote
MIN_ABS_SPREAD_OK = 0.05  # a 5-cent wide market is fine even on a cheap option
MIN_PRICE = 0.01
MIN_SMILE_POINTS = 3
IV_LO, IV_HI = 1e-4, 5.0


# ── Black-76 on the forward (undiscounted prices) ───────────────────────────

def norm_cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def black_price(fwd: float, strike: float, t: float, sigma: float, is_call: bool) -> float:
    """Undiscounted Black-76 price. Multiply by e^{-rT} for the present value."""
    if sigma <= 0 or t <= 0:
        intrinsic = fwd - strike if is_call else strike - fwd
        return max(intrinsic, 0.0)
    vs = sigma * math.sqrt(t)
    d1 = (math.log(fwd / strike) + 0.5 * vs * vs) / vs
    d2 = d1 - vs
    if is_call:
        return fwd * norm_cdf(d1) - strike * norm_cdf(d2)
    return strike * norm_cdf(-d2) - fwd * norm_cdf(-d1)


def black_iv(price: float, fwd: float, strike: float, t: float, is_call: bool,
             tol: float = 1e-7) -> Optional[float]:
    """Implied vol from an undiscounted price by bisection; None outside the no-arbitrage band."""
    if not (price > 0 and fwd > 0 and strike > 0 and t > 0):
        return None
    lo, hi = IV_LO, IV_HI
    if not (black_price(fwd, strike, t, lo, is_call) - 1e-9 <= price <= black_price(fwd, strike, t, hi, is_call)):
        return None
    for _ in range(120):
        mid = 0.5 * (lo + hi)
        if black_price(fwd, strike, t, mid, is_call) > price:
            hi = mid
        else:
            lo = mid
        if hi - lo < tol:
            break
    return 0.5 * (lo + hi)


def prob_above_flat(fwd: float, strike: float, t: float, sigma: float) -> float:
    """Risk-neutral P(S_T > K) for a flat vol: N(d2)."""
    vs = sigma * math.sqrt(t)
    return norm_cdf((math.log(fwd / strike) - 0.5 * vs * vs) / vs)


# ── Quotes ───────────────────────────────────────────────────────────────────

def _pos(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f) or f <= 0:
        return None
    return f


def liquid_mid(c: Dict[str, Any]) -> Optional[float]:
    """Mid of a usable two-sided market, else None."""
    bid, ask = _pos(c.get("bid")), _pos(c.get("ask"))
    if bid is None or ask is None or ask < bid:
        return None
    mid = 0.5 * (bid + ask)
    if mid < MIN_PRICE:
        return None
    if (ask - bid) > max(MAX_REL_SPREAD * mid, MIN_ABS_SPREAD_OK):
        return None
    return mid


def traded_last(c: Dict[str, Any]) -> Optional[float]:
    """Last trade price, only for contracts with volume or open interest."""
    last = _pos(c.get("last"))
    if last is None or last < MIN_PRICE:
        return None
    if not ((c.get("volume") or 0) > 0 or (c.get("open_interest") or 0) > 0):
        return None
    return last


def _price_map(contracts: Iterable[Dict[str, Any]], basis: str) -> Dict[float, float]:
    out: Dict[float, float] = {}
    pick = liquid_mid if basis == "mid" else traded_last
    for c in contracts:
        k = _pos(c.get("strike"))
        if k is None:
            continue
        p = pick(c)
        if p is not None:
            out[k] = p
    return out


# ── Forward, smile, distribution ────────────────────────────────────────────

def implied_forward(calls: Dict[float, float], puts: Dict[float, float], spot: float,
                    r: float, t: float) -> Tuple[float, str]:
    """Forward from put-call parity on the 3 strikes where |C - P| is smallest."""
    common = sorted(set(calls) & set(puts), key=lambda k: abs(calls[k] - puts[k]))[:3]
    if common:
        fwds = sorted(k + math.exp(r * t) * (calls[k] - puts[k]) for k in common)
        f = fwds[len(fwds) // 2]
        if f > 0 and abs(f / spot - 1.0) < 0.2:
            return f, "put_call_parity"
    return spot * math.exp(r * t), "spot_carry"


@dataclass
class Smile:
    """Implied vol by strike: a smooth fit through the quoted OTM vols, flat wings.

    Quoted vols zig-zag by a point or two between neighbouring strikes (bid/ask
    noise, stale prints). Breeden-Litzenberger differentiates the smile, so
    interpolating those wiggles exactly turns them into huge swings in
    probability. Instead the vol is a weighted least-squares quadratic in
    log-moneyness (weights favour strikes near the money, where most of the
    probability mass sits), held flat beyond the outermost quoted strike.
    ``ks`` / ``ws`` / ``strikes`` keep the raw quoted points for display.
    """
    fwd: float
    t: float
    ks: List[float]       # log-moneyness of quoted points, ascending
    ws: List[float]       # quoted total variance sigma^2 T
    strikes: List[float]
    coef: Tuple[float, float, float] = (0.0, 0.0, 0.0)  # sigma(k) = a + b k + c k^2

    def __post_init__(self) -> None:
        if self.coef == (0.0, 0.0, 0.0):
            self.coef = fit_smile(self.ks, [math.sqrt(w / self.t) for w in self.ws], self.t)

    def iv(self, strike: float) -> float:
        """Fitted vol inside the quoted strikes; beyond them the smile continues
        along its edge slope (no kink, so no artificial jump in probability),
        within Lee's moment bound |d(sigma^2 T)/dk| <= 2 and above half the
        lowest quoted vol."""
        k = math.log(strike / self.fwd)
        a, b, c = self.coef
        lo, hi = self.ks[0], self.ks[-1]
        if lo <= k <= hi:
            return max(a + b * k + c * k * k, 0.01)
        edge = lo if k < lo else hi
        s_edge = max(a + b * edge + c * edge * edge, 0.01)
        slope = b + 2 * c * edge
        cap = 1.0 / (s_edge * self.t)
        slope = max(-cap, min(cap, slope))
        floor = max(0.01, 0.5 * min(math.sqrt(w / self.t) for w in self.ws))
        d = k - edge
        if d * slope < 0:
            # vol falling further into the wing: taper the slope to zero over about
            # one standard deviation instead of letting the wing collapse
            scale = max(s_edge * math.sqrt(self.t), 0.02)
            step = math.copysign(scale * (1.0 - math.exp(-abs(d) / scale)), d)
            return min(max(s_edge + slope * step, floor), IV_HI)
        return min(max(s_edge + slope * d, floor), IV_HI)

    def total_var(self, strike: float) -> float:
        return self.iv(strike) ** 2 * self.t

    def call(self, strike: float) -> float:
        return black_price(self.fwd, strike, self.t, self.iv(strike), True)

    def prob_above(self, strike: float) -> float:
        """Breeden-Litzenberger: P(S_T > K) = -dC/dK (undiscounted)."""
        h = max(strike * 1e-4, 1e-6)
        p = -(self.call(strike + h) - self.call(strike - h)) / (2 * h)
        return min(1.0, max(0.0, p))

    @property
    def flat(self) -> bool:
        return len(self.ks) == 1


def _solve(m: List[List[float]], v: List[float]) -> Optional[List[float]]:
    """Gaussian elimination with partial pivoting; None when singular."""
    n = len(v)
    a = [row[:] + [v[i]] for i, row in enumerate(m)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[piv][col]) < 1e-14:
            return None
        a[col], a[piv] = a[piv], a[col]
        for r in range(col + 1, n):
            f = a[r][col] / a[col][col]
            for j in range(col, n + 1):
                a[r][j] -= f * a[col][j]
    x = [0.0] * n
    for i in reversed(range(n)):
        x[i] = (a[i][n] - sum(a[i][j] * x[j] for j in range(i + 1, n))) / a[i][i]
    return x


def _wls(ks: Sequence[float], ys: Sequence[float], ws: Sequence[float], deg: int) -> Optional[List[float]]:
    m = [[sum(w * k ** (i + j) for k, w in zip(ks, ws)) for j in range(deg + 1)] for i in range(deg + 1)]
    v = [sum(w * y * k ** i for k, y, w in zip(ks, ys, ws)) for i in range(deg + 1)]
    return _solve(m, v)


def fit_smile(ks: Sequence[float], vols: Sequence[float], t: float) -> Tuple[float, float, float]:
    """(a, b, c) of sigma(k) = a + b k + c k^2 by weighted least squares.

    Weight 1 / (1 + (k / 2 s sqrt T)^2), s = the vol nearest the money, so the fit
    tracks the body of the distribution and wing quotes only shape the tails. A
    concave fit (c < 0, vol falling in both wings) is not a plausible equity smile:
    fall back to a straight line, then to a constant.
    """
    if len(ks) == 1:
        return (vols[0], 0.0, 0.0)
    s0 = vols[min(range(len(ks)), key=lambda i: abs(ks[i]))]
    scale = max(2.0 * s0 * math.sqrt(t), 0.02)
    wts = [1.0 / (1.0 + (k / scale) ** 2) for k in ks]
    if len(ks) >= 4:
        q = _wls(ks, vols, wts, 2)
        if q is not None and q[2] >= 0:
            return (q[0], q[1], q[2])
    lin = _wls(ks, vols, wts, 1)
    if lin is not None:
        return (lin[0], lin[1], 0.0)
    return (sum(vols) / len(vols), 0.0, 0.0)


def build_smile(calls: Dict[float, float], puts: Dict[float, float], fwd: float,
                r: float, t: float) -> Optional[Smile]:
    """OTM implied vols; None with fewer than MIN_SMILE_POINTS solvable strikes."""
    growth = math.exp(r * t)
    pts: List[Tuple[float, float, float]] = []
    for k in sorted(set(calls) | set(puts)):
        use_call = k >= fwd
        price = calls.get(k) if use_call else puts.get(k)
        if price is None:
            continue
        iv = black_iv(price * growth, fwd, k, t, use_call)
        if iv is None or not (0.01 <= iv <= IV_HI * 0.99):
            continue
        pts.append((math.log(k / fwd), iv * iv * t, k))
    pts = _drop_outliers(pts, t)
    if len(pts) < MIN_SMILE_POINTS:
        return None
    return Smile(fwd=fwd, t=t, ks=[p[0] for p in pts], ws=[p[1] for p in pts], strikes=[p[2] for p in pts])


def _drop_outliers(pts: List[Tuple[float, float, float]], t: float, window: int = 2,
                   tol: float = 0.35) -> List[Tuple[float, float, float]]:
    """Drop a strike whose vol is more than ``tol`` (relative) away from the median
    of its neighbours: a stale or fat-fingered quote, not a real smile feature."""
    if len(pts) < 2 * window + 1:
        return pts
    vols = [math.sqrt(w / t) for _, w, _ in pts]
    keep = []
    for i, p in enumerate(pts):
        nb = sorted(vols[max(0, i - window):i] + vols[i + 1:i + 1 + window])
        med = nb[len(nb) // 2] if len(nb) % 2 else 0.5 * (nb[len(nb) // 2 - 1] + nb[len(nb) // 2])
        if med > 0 and abs(vols[i] - med) / med > tol:
            continue
        keep.append(p)
    return keep


def flat_smile(fwd: float, t: float, sigma: float) -> Smile:
    return Smile(fwd=fwd, t=t, ks=[0.0], ws=[sigma * sigma * t], strikes=[fwd], coef=(sigma, 0.0, 0.0))


def straddle_iv(straddle_undiscounted: float, fwd: float, t: float) -> Optional[float]:
    """Vol at which an at-the-forward straddle (call + put, each worth
    F (2N(sigma sqrt T / 2) - 1) undiscounted) has the given price."""
    x = straddle_undiscounted / (2.0 * fwd)
    if not (0 < x < 1):
        return None
    # invert 2N(y) - 1 = x for y = sigma sqrt(T) / 2
    lo, hi = 0.0, 10.0
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if 2 * norm_cdf(mid) - 1 > x:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / math.sqrt(t)  # sigma = 2y / sqrt(T), y = (lo + hi) / 2


def distribution(smile: Smile, n: int = 161, width: float = 4.5) -> List[Tuple[float, float]]:
    """[(strike, P(S_T > strike))] on a log-spaced grid, monotone non-increasing."""
    s_atm = smile.iv(smile.fwd)
    span = width * s_atm * math.sqrt(smile.t)
    lo, hi = math.log(smile.fwd) - span, math.log(smile.fwd) + span
    grid = [math.exp(lo + (hi - lo) * i / (n - 1)) for i in range(n)]
    probs = _isotonic_decreasing([smile.prob_above(k) for k in grid])
    return list(zip(grid, probs))


def _isotonic_decreasing(ys: List[float]) -> List[float]:
    """Closest non-increasing sequence in least squares (pool adjacent violators).

    Unlike a running minimum, one low point does not drag down everything after it.
    """
    blocks: List[List[float]] = []  # [mean, count]
    for y in ys:
        blocks.append([y, 1.0])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            m2, n2 = blocks.pop()
            m1, n1 = blocks.pop()
            blocks.append([(m1 * n1 + m2 * n2) / (n1 + n2), n1 + n2])
    out: List[float] = []
    for m, n in blocks:
        out.extend([min(1.0, max(0.0, m))] * int(n))
    return out


def quantile(dist: Sequence[Tuple[float, float]], p: float) -> Optional[float]:
    """Strike with P(S_T <= K) = p, linear between grid points."""
    prev_k, prev_c = None, None
    for k, above in dist:
        c = 1.0 - above
        if c >= p:
            if prev_k is None or c == prev_c:
                return k
            return prev_k + (k - prev_k) * (p - prev_c) / (c - prev_c)
        prev_k, prev_c = k, c
    return None


# ── Straddle ─────────────────────────────────────────────────────────────────

def atm_straddle(calls: Dict[float, float], puts: Dict[float, float], fwd: float) -> Optional[Tuple[float, float]]:
    """(strike, call + put) at the strike nearest the forward with both sides priced."""
    common = set(calls) & set(puts)
    if not common:
        return None
    k = min(common, key=lambda s: abs(s - fwd))
    return k, calls[k] + puts[k]


# ── One expiry ───────────────────────────────────────────────────────────────

def _year_fraction(expiration: str, now: Optional[datetime]) -> float:
    from app.services.option_greeks import year_fraction

    return year_fraction(expiration, now)


def analyse_expiry(calls: List[Dict[str, Any]], puts: List[Dict[str, Any]], spot: float,
                   expiration: str, r: float, now: Optional[datetime] = None) -> Optional[dict]:
    """Implied move, ranges and smile for one expiry, or None when nothing is priced."""
    if not spot or spot <= 0:
        return None
    t = _year_fraction(expiration, now)
    today = (now or datetime.now(timezone.utc)).date()
    basis = "mid"
    cm, pm = _price_map(calls, "mid"), _price_map(puts, "mid")
    if len(set(cm) | set(pm)) < MIN_SMILE_POINTS or not (set(cm) & set(pm)):
        cl, pl = _price_map(calls, "last"), _price_map(puts, "last")
        if len(set(cl) | set(pl)) > len(set(cm) | set(pm)):
            cm, pm, basis = cl, pl, "last"
    if not cm and not pm:
        return None

    growth = math.exp(r * t)
    if basis == "mid":
        fwd, fwd_method = implied_forward(cm, pm, spot, r, t)
        smile = build_smile(cm, pm, fwd, r, t)
        smile_method = "smile"
    else:
        # Last trades print at different times, so parity and strike-to-strike
        # differences are noise. Use the carry forward and one flat vol: the
        # median OTM vol of the four strikes nearest the money.
        fwd, fwd_method = spot * growth, "spot_carry"
        near = build_smile(cm, pm, fwd, r, t)
        smile, smile_method = None, "atm_last"
        if near is not None:
            by_dist = sorted(zip(near.ks, near.ws), key=lambda kw: abs(kw[0]))[:4]
            vols = sorted(math.sqrt(w / t) for _, w in by_dist)
            smile = flat_smile(fwd, t, vols[len(vols) // 2])
    straddle = atm_straddle(cm, pm, fwd)
    if smile is None:
        sig = straddle_iv(straddle[1] * growth, fwd, t) if straddle else None
        if sig is None:
            return None
        smile, smile_method = flat_smile(fwd, t, sig), "straddle_flat"

    dist = distribution(smile)
    q = {p: quantile(dist, p) for p in (0.025, 0.1, 0.16, 0.25, 0.5, 0.75, 0.84, 0.9, 0.975)}
    atm_iv = smile.iv(fwd)

    move = None
    if straddle:
        k, px = straddle
        exp_abs = px * growth
        move = {
            "strike": round(k, 4),
            "price": round(px, 4),
            "move": round(exp_abs, 4),
            "move_pct": round(exp_abs / spot * 100, 3),
            "low": round(spot - exp_abs, 4),
            "high": round(spot + exp_abs, 4),
        }

    liquid_count = len(_price_map(calls, "mid")) + len(_price_map(puts, "mid"))
    quality = "good"
    if basis == "last" or smile_method != "smile":
        quality = "thin"
    elif len(smile.ks) < 6:
        quality = "fair"

    def rnd(x: Optional[float]) -> Optional[float]:
        return None if x is None else round(x, 4)

    exp_d = date.fromisoformat(expiration[:10])
    return {
        "expiration": expiration[:10],
        "days": (exp_d - today).days,
        "t_years": round(t, 6),
        "spot": round(spot, 4),
        "forward": round(fwd, 4),
        "forward_method": fwd_method,
        "atm_iv": round(atm_iv, 4),
        "one_sigma_pct": round(atm_iv * math.sqrt(t) * 100, 3),
        "straddle": move,
        "range_68": [rnd(q[0.16]), rnd(q[0.84])],
        "range_80": [rnd(q[0.1]), rnd(q[0.9])],
        "range_95": [rnd(q[0.025]), rnd(q[0.975])],
        "median": rnd(q[0.5]),
        "prob_above_spot": round(min(1.0, max(0.0, _interp_above(dist, spot))), 4),
        "quote_basis": basis,
        "smile_method": smile_method,
        "smile_points": len(smile.ks) if smile_method == "smile" else 0,
        "liquid_contracts": liquid_count,
        "quality": quality,
        "_smile": smile,
        "_dist": dist,
    }


def _interp_above(dist: Sequence[Tuple[float, float]], strike: float) -> float:
    if strike <= dist[0][0]:
        return dist[0][1]
    if strike >= dist[-1][0]:
        return dist[-1][1]
    for (k0, p0), (k1, p1) in zip(dist, dist[1:]):
        if k0 <= strike <= k1:
            return p0 + (p1 - p0) * (strike - k0) / (k1 - k0)
    return dist[-1][1]


def probability(analysis: dict, target: float) -> dict:
    """P(above) / P(below) a target price at this expiry, from the analysed smile."""
    smile: Smile = analysis["_smile"]
    dist = analysis["_dist"]
    lo, hi = dist[0][0], dist[-1][0]
    if lo <= target <= hi:
        above = _interp_above(dist, target)
    else:  # far tails: direct BL on the flat-extrapolated wing
        above = smile.prob_above(target)
    above = min(1.0, max(0.0, above))
    return {
        "target": round(target, 4),
        "prob_above": round(above, 4),
        "prob_below": round(1 - above, 4),
        "iv_at_target": round(smile.iv(target), 4),
        "flat_iv_prob_above": round(prob_above_flat(smile.fwd, target, smile.t, analysis["atm_iv"]), 4),
    }


def public(analysis: dict, curve_points: int = 0) -> dict:
    """Strip private fields; optionally include a thinned CDF/density curve for charts."""
    out = {k: v for k, v in analysis.items() if not k.startswith("_")}
    if curve_points:
        dist = analysis["_dist"]
        step = max(1, len(dist) // curve_points)
        pts = []
        for i in range(0, len(dist), step):
            k, above = dist[i]
            # difference over +-3 grid steps: a display density that does not
            # flicker to zero where isotonic pooling flattened a short stretch
            j0, j1 = max(0, i - 3), min(len(dist) - 1, i + 3)
            dk = dist[j1][0] - dist[j0][0]
            dens = (dist[j0][1] - dist[j1][1]) / dk if dk > 0 else 0.0
            pts.append({"price": round(k, 4), "prob_above": round(above, 4), "density": round(max(dens, 0.0), 6)})
        out["curve"] = pts
        smile: Smile = analysis["_smile"]
        if not smile.flat:
            out["smile"] = [{"strike": round(k, 4), "iv": round(math.sqrt(w / smile.t), 4)}
                            for k, w in zip(smile.strikes, smile.ws)]
        else:
            out["smile"] = []
    return out


# ── Event (earnings) move from the term structure ───────────────────────────

def event_move_pct(before: Optional[dict], after: dict) -> Optional[float]:
    """Expected absolute one-day event move (%) implied by the term structure.

    Total variance to the post-event expiry minus ordinary-day variance at the
    pre-event expiry's vol for the remaining days: sigma_e^2 = s2^2 T2 - s1^2 (T2 - 1/252).
    Expected |move| of a normal with that variance is sigma_e sqrt(2/pi).
    None when there is no pre-event expiry or the difference is not positive.
    """
    if not before:
        return None
    s1, s2 = before["atm_iv"], after["atm_iv"]
    t2 = after["t_years"]
    ordinary = max(t2 - 1.0 / 252.0, 0.0)
    var_e = s2 * s2 * t2 - s1 * s1 * ordinary
    if var_e <= 0:
        return None
    return round(math.sqrt(var_e) * math.sqrt(2.0 / math.pi) * 100, 3)
