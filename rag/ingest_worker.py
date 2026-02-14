"""
QuantTrade AI - Ingestion Worker

Thin CLI wrapper around ``DataIngestionPipeline`` so that data ingestion
can be run as a standalone container or cron-style task.
"""

import argparse
import os
import sys
from typing import List

from data_ingestion import DataIngestionPipeline, RAGConfig, VectorDB


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="QuantTrade AI data ingestion worker",
    )
    parser.add_argument(
        "--symbols",
        nargs="+",
        required=True,
        help="List of ticker symbols to ingest (e.g. AAPL MSFT NVDA).",
    )
    parser.add_argument(
        "--mode",
        choices=["full", "fundamentals", "news"],
        default="full",
        help="Which ingestion pipeline to run.",
    )
    return parser.parse_args(argv)


def main(argv: List[str] | None = None) -> None:
    args = parse_args(argv or sys.argv[1:])

    config = RAGConfig()
    vector_db = VectorDB(config)

    pipeline = DataIngestionPipeline(
        vector_db=vector_db,
        alpha_vantage_key=os.getenv("ALPHA_VANTAGE_API_KEY"),
        fmp_key=os.getenv("FMP_API_KEY"),
    )

    symbols = [s.upper() for s in args.symbols]
    print(f"🚀 Starting ingestion worker for symbols: {', '.join(symbols)} (mode={args.mode})")

    for symbol in symbols:
        if args.mode in ("full", "fundamentals"):
            try:
                pipeline.ingest_fundamentals(symbol)
            except Exception as exc:  # pragma: no cover - defensive
                print(f"⚠️ Error ingesting fundamentals for {symbol}: {exc}")

        if args.mode in ("full", "news"):
            try:
                pipeline.ingest_news(symbol)
            except Exception as exc:  # pragma: no cover - defensive
                print(f"⚠️ Error ingesting news for {symbol}: {exc}")

    print("✅ Ingestion worker completed.")


if __name__ == "__main__":
    main()

