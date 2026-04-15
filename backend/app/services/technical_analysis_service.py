"""
Real Technical Analysis Service

Computes indicators from live price data via MarketDataService.
No synthetic data, no random numbers. All signals from real OHLCV.

Usage:
    from app.services.technical_analysis_service import ta_service

    signals = await ta_service.compute_signals("AAPL")
    breakout = await ta_service.detect_breakout("AAPL")
"""
import logging
from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np
import pandas as pd

from app.services.market_data_service import market_data
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)


@dataclass
class TechnicalSignals:
    symbol: str
    price: float
    rsi_14: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_histogram: Optional[float] = None
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    ema_9: Optional[float] = None
    ema_21: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    atr_14: Optional[float] = None
    volume: int = 0
    avg_volume: int = 0
    volume_ratio: float = 1.0
    change_pct: float = 0.0
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    # Computed signals
    trend: str = "neutral"         # bullish, bearish, neutral
    momentum: str = "neutral"      # strong_bull, bull, neutral, bear, strong_bear
    volatility: str = "normal"     # low, normal, high
    signal_strength: int = 0       # -100 to +100
    source: str = "unknown"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class BreakoutSignal:
    symbol: str
    direction: str        # "breakout" or "breakdown"
    price: float
    trigger_level: float  # The level that was breached
    trigger_type: str     # "52w_high", "bb_upper", "resistance", "52w_low", "bb_lower", "support"
    volume_ratio: float
    confidence: int       # 0-100

    def to_dict(self) -> dict:
        return asdict(self)


def _safe(val) -> Optional[float]:
    """Convert to float, None if NaN."""
    if val is None:
        return None
    try:
        if pd.isna(val) or np.isnan(float(val)):
            return None
        return round(float(val), 4)
    except (TypeError, ValueError):
        return None


class TechnicalAnalysisService:
    """Compute real technical indicators from live market data."""

    SIGNALS_TTL = 120  # 2 minutes cache

    async def compute_signals(self, symbol: str) -> Optional[TechnicalSignals]:
        """Full technical analysis from real OHLCV data."""
        cache_key = f"qt:ta:{symbol}"

        async def _compute():
            # Fetch 1 year of data for 200-day SMA + 52-week high/low
            df = await market_data.get_historical(symbol, period="1y")
            if df is None or len(df) < 30:
                return None

            close = df["Close"]
            high = df["High"]
            low = df["Low"]
            volume = df["Volume"]
            price = float(close.iloc[-1])

            # RSI 14
            delta = close.diff()
            gain = delta.where(delta > 0, 0).rolling(14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs))

            # MACD (12, 26, 9)
            ema_12 = close.ewm(span=12, adjust=False).mean()
            ema_26 = close.ewm(span=26, adjust=False).mean()
            macd_line = ema_12 - ema_26
            signal_line = macd_line.ewm(span=9, adjust=False).mean()
            histogram = macd_line - signal_line

            # Moving averages
            sma_20 = close.rolling(20).mean()
            sma_50 = close.rolling(50).mean()
            sma_200 = close.rolling(200).mean()
            ema_9 = close.ewm(span=9, adjust=False).mean()
            ema_21 = close.ewm(span=21, adjust=False).mean()

            # Bollinger Bands (20, 2)
            bb_mid = sma_20
            bb_std = close.rolling(20).std()
            bb_upper = bb_mid + (bb_std * 2)
            bb_lower = bb_mid - (bb_std * 2)

            # ATR 14
            tr = pd.concat([
                high - low,
                (high - close.shift()).abs(),
                (low - close.shift()).abs(),
            ], axis=1).max(axis=1)
            atr = tr.rolling(14).mean()

            # Volume
            vol = int(volume.iloc[-1]) if len(volume) > 0 else 0
            avg_vol = int(volume.rolling(20).mean().iloc[-1]) if len(volume) >= 20 else vol
            vol_ratio = round(vol / max(avg_vol, 1), 2)

            # Change %
            prev = float(close.iloc[-2]) if len(close) > 1 else price
            change = round(((price - prev) / prev * 100) if prev else 0, 2)

            # 52-week high/low
            h52 = float(high.iloc[-252:].max()) if len(high) >= 252 else float(high.max())
            l52 = float(low.iloc[-252:].min()) if len(low) >= 252 else float(low.min())

            # Determine trend
            s200 = _safe(sma_200.iloc[-1])
            s50 = _safe(sma_50.iloc[-1])
            if s200 and s50:
                if price > s200 and s50 > s200:
                    trend = "bullish"
                elif price < s200 and s50 < s200:
                    trend = "bearish"
                else:
                    trend = "neutral"
            else:
                trend = "neutral"

            # Determine momentum
            rsi_val = _safe(rsi.iloc[-1])
            macd_hist_val = _safe(histogram.iloc[-1])
            if rsi_val is not None and macd_hist_val is not None:
                if rsi_val > 70 and macd_hist_val > 0:
                    momentum = "strong_bull"
                elif rsi_val > 50 and macd_hist_val > 0:
                    momentum = "bull"
                elif rsi_val < 30 and macd_hist_val < 0:
                    momentum = "strong_bear"
                elif rsi_val < 50 and macd_hist_val < 0:
                    momentum = "bear"
                else:
                    momentum = "neutral"
            else:
                momentum = "neutral"

            # Volatility
            atr_val = _safe(atr.iloc[-1])
            if atr_val and price:
                atr_pct = atr_val / price * 100
                volatility = "high" if atr_pct > 3 else ("low" if atr_pct < 1 else "normal")
            else:
                volatility = "normal"

            # Signal strength (-100 to +100)
            strength = 0
            if rsi_val is not None:
                if rsi_val < 30:
                    strength += 25  # Oversold = bullish signal
                elif rsi_val < 40:
                    strength += 10
                elif rsi_val > 70:
                    strength -= 25  # Overbought = bearish signal
                elif rsi_val > 60:
                    strength -= 10
            if trend == "bullish":
                strength += 20
            elif trend == "bearish":
                strength -= 20
            if macd_hist_val is not None:
                if macd_hist_val > 0:
                    strength += 15
                else:
                    strength -= 15
            if vol_ratio > 2.0:
                strength += 10 if change > 0 else -10
            if change > 3:
                strength += 15
            elif change < -3:
                strength -= 15
            strength = max(-100, min(100, strength))

            signals = TechnicalSignals(
                symbol=symbol,
                price=round(price, 2),
                rsi_14=_safe(rsi.iloc[-1]),
                macd=_safe(macd_line.iloc[-1]),
                macd_signal=_safe(signal_line.iloc[-1]),
                macd_histogram=_safe(histogram.iloc[-1]),
                sma_20=_safe(sma_20.iloc[-1]),
                sma_50=_safe(sma_50.iloc[-1]),
                sma_200=_safe(sma_200.iloc[-1]),
                ema_9=_safe(ema_9.iloc[-1]),
                ema_21=_safe(ema_21.iloc[-1]),
                bb_upper=_safe(bb_upper.iloc[-1]),
                bb_middle=_safe(bb_mid.iloc[-1]),
                bb_lower=_safe(bb_lower.iloc[-1]),
                atr_14=_safe(atr.iloc[-1]),
                volume=vol,
                avg_volume=avg_vol,
                volume_ratio=vol_ratio,
                change_pct=change,
                high_52w=round(h52, 2),
                low_52w=round(l52, 2),
                trend=trend,
                momentum=momentum,
                volatility=volatility,
                signal_strength=strength,
                source="yfinance",
            )
            return signals.to_dict()

        data = await cache_service.get_or_fetch(cache_key, self.SIGNALS_TTL, _compute)
        if data:
            return TechnicalSignals(**data)
        return None

    async def detect_breakout(self, symbol: str) -> Optional[BreakoutSignal]:
        """Detect breakout/breakdown from real price data."""
        signals = await self.compute_signals(symbol)
        if not signals or not signals.price:
            return None

        price = signals.price
        confidence = 0
        direction = None
        trigger_level = 0.0
        trigger_type = ""

        # Check 52-week high breakout
        if signals.high_52w and price >= signals.high_52w * 0.98:
            direction = "breakout"
            trigger_level = signals.high_52w
            trigger_type = "52w_high"
            confidence = 75 if price >= signals.high_52w else 60

        # Check Bollinger upper band breakout
        elif signals.bb_upper and price > signals.bb_upper:
            direction = "breakout"
            trigger_level = signals.bb_upper
            trigger_type = "bb_upper"
            confidence = 65

        # Check 52-week low breakdown
        elif signals.low_52w and price <= signals.low_52w * 1.02:
            direction = "breakdown"
            trigger_level = signals.low_52w
            trigger_type = "52w_low"
            confidence = 75 if price <= signals.low_52w else 60

        # Check Bollinger lower band breakdown
        elif signals.bb_lower and price < signals.bb_lower:
            direction = "breakdown"
            trigger_level = signals.bb_lower
            trigger_type = "bb_lower"
            confidence = 65

        if not direction:
            return None

        # Boost confidence with volume confirmation
        if signals.volume_ratio > 2.0:
            confidence = min(95, confidence + 15)
        elif signals.volume_ratio > 1.5:
            confidence = min(95, confidence + 8)

        return BreakoutSignal(
            symbol=symbol,
            direction=direction,
            price=price,
            trigger_level=round(trigger_level, 2),
            trigger_type=trigger_type,
            volume_ratio=signals.volume_ratio,
            confidence=confidence,
        )


# Singleton
ta_service = TechnicalAnalysisService()
