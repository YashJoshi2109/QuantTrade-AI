"""News provider implementations (GDELT, Finnhub)."""
from __future__ import annotations

from data.providers.news.gdelt import GDELTProvider
from data.providers.news.finnhub import FinnhubFreeProvider

__all__ = ["GDELTProvider", "FinnhubFreeProvider"]
