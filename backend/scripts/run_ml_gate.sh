#!/usr/bin/env bash
# One command: data -> features -> purged walk-forward -> 10-point gate ->
# robustness re-runs -> registry record (see ml/gate_pipeline.py).
#
#   cd backend && scripts/run_ml_gate.sh            # research panel if present, else OHLCV cache
#   ML_DATA_ROOT=/path/to/backend/ml scripts/run_ml_gate.sh --publish
#
# ML_DATA_ROOT defaults to this checkout's backend/ml. The research panel and
# cache are not in git (ml/checkpoints, ml/data_cache); point ML_DATA_ROOT at a
# checkout that has them. Extra arguments are passed to the pipeline.
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="${ML_DATA_ROOT:-$PWD/ml}"
PANEL="$ROOT/checkpoints/artifacts/free_data/tier2/processed/panel_tier2.parquet"
OHLCV="$ROOT/checkpoints/artifacts/free_data/tier2/processed/ohlcv_raw.parquet"
CACHE="$ROOT/data_cache"
OUT="${ML_GATE_OUT:-$PWD/ml/checkpoints/artifacts/phase10}"

if [[ -f "$PANEL" && -f "$OHLCV" ]]; then
  SRC=(--source panel --panel "$PANEL" --ohlcv "$OHLCV")
else
  echo "research panel not found under $ROOT; using the OHLCV cache (no SEC features)" >&2
  SRC=(--source cache --cache-dir "$CACHE")
fi

exec python -m ml.gate_pipeline "${SRC[@]}" \
  --spy "$CACHE/SPY_max.parquet" --sectors "$CACHE/sector_metadata.json" \
  --out "$OUT" --n-jobs "${ML_GATE_JOBS:-6}" "$@"
