"""
QuantTrade AI - Prediction Service
FastAPI microservice that exposes stock price predictions produced by
the models defined in ``predictive_rag.py``.

This service is designed to be run as a separate container and called
by the main QuantTrade backend or directly by the frontend.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from predictive_rag import AdvancedRAGConfig, PricePrediction, StockPredictor


app = FastAPI(
    title="QuantTrade AI Prediction Service",
    description="Real-time price prediction API built on QuantTrade's ML models.",
    version="0.1.0",
)


class PredictionRequest(BaseModel):
    symbol: str
    # Optional explicit horizons in days (e.g. [1, 7, 30])
    horizons: Optional[List[int]] = None


class PredictionOut(BaseModel):
    timeframe: str
    predicted_price: float
    current_price: float
    confidence: float
    direction: str
    probability_up: float
    range_low: float
    range_high: float
    expected_return: float

    @classmethod
    def from_dataclass(cls, p: PricePrediction) -> "PredictionOut":
        return cls(
            timeframe=p.timeframe,
            predicted_price=float(p.predicted_price),
            current_price=float(p.current_price),
            confidence=float(p.confidence),
            direction=p.direction,
            probability_up=float(p.probability_up),
            range_low=float(p.range_low),
            range_high=float(p.range_high),
            expected_return=float(p.expected_return),
        )


class PredictionResponse(BaseModel):
    symbol: str
    generated_at: datetime
    horizons: List[int]
    predictions: List[PredictionOut]


config = AdvancedRAGConfig()
predictor = StockPredictor()


@app.get("/health")
async def health() -> dict:
    """Simple health check used by container orchestrators."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.post("/api/v1/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest) -> PredictionResponse:
    """
    Generate predictions for a symbol.

    - If ``horizons`` is provided, predictions are generated for those day offsets.
    - Otherwise, the default horizons from ``AdvancedRAGConfig.PREDICTION_HORIZONS`` are used.
    """
    symbol = request.symbol.upper().strip()
    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol is required.")

    try:
        if request.horizons:
            horizon_map = {f"{days}_day": days for days in request.horizons}
        else:
            horizon_map = AdvancedRAGConfig.PREDICTION_HORIZONS

        predictions: List[PredictionOut] = []
        numeric_horizons: List[int] = []

        for name, days in horizon_map.items():
            if days <= 0:
                continue
            price_pred = predictor.predict(symbol, days)
            # Ensure timeframe label matches the config key for downstream display
            price_pred.timeframe = name
            predictions.append(PredictionOut.from_dataclass(price_pred))
            numeric_horizons.append(days)

        if not predictions:
            raise HTTPException(
                status_code=400,
                detail="No valid horizons provided for prediction.",
            )

        return PredictionResponse(
            symbol=symbol,
            generated_at=datetime.utcnow(),
            horizons=numeric_horizons,
            predictions=predictions,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        # Surface data-availability issues as a 400 so callers understand why
        # predictions could not be produced.
        print(f"⚠️ Prediction data issue for {symbol}: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover - defensive catch
        # We surface a generic error to clients but log the full details to stderr.
        # The container runtime / logging stack should capture stdout/stderr.
        print(f"❌ Prediction error for {symbol}: {exc}")
        raise HTTPException(status_code=500, detail="Prediction service error.")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "prediction_server:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
    )

