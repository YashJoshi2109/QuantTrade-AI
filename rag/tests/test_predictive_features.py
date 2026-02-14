import numpy as np

from predictive_rag import StockPredictor


def test_prepare_features_shape_and_nan_free(monkeypatch):
    """
    Smoke test that ``prepare_features`` returns a 2D numpy array with no NaNs
    for a short lookback window.
    """

    # Patch yfinance download to avoid hitting the network in unit tests.
    import yfinance as yf

    def fake_history(self, period="60d"):
        import pandas as pd

        idx = pd.date_range("2024-01-01", periods=60, freq="D")
        df = pd.DataFrame(
            {
                "Close": np.linspace(100, 110, 60),
                "Volume": np.linspace(1_000_000, 2_000_000, 60),
            },
            index=idx,
        )
        return df

    monkeypatch.setattr(yf.Ticker, "history", fake_history, raising=False)

    predictor = StockPredictor()
    features = predictor.prepare_features("AAPL", lookback_days=60)

    assert features.ndim == 2
    assert features.shape[0] > 0
    assert features.shape[1] > 0
    assert not np.isnan(features).any()

