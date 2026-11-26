"""Hard limits for one backtest request.

The API container has 768 MB and one uvicorn worker. These bounds keep the
worst single request to a few seconds of CPU and a few tens of MB:
10 symbols x 25 years ~ 63k bars; a 60-combo sweep re-runs the loop 60 times;
Monte Carlo is capped at 2M cells (sims x bars).
"""
from __future__ import annotations

MAX_YEARS = 25
MAX_SYMBOLS = 10
MAX_SCAN_SYMBOLS = 25
MAX_GRID_COMBOS = 60
MAX_PARAM_VALUES = 12
# symbols x trading days x parameter combinations; ~1.5M is ~40 s of engine time
MAX_WORK_CELLS = 1_500_000
MAX_WINDOW = 400  # longest indicator window, in bars
MAX_CONDITIONS = 12
MAX_RULE_DEPTH = 3
MAX_MC_SIMS = 2000
MAX_WF_FOLDS = 10
MAX_CAPITAL = 1e9
MAX_COST_BPS = 500.0
RUN_TIME_BUDGET_S = 20.0
JOB_TIME_BUDGET_S = 60.0
SCAN_TIME_BUDGET_S = 60.0
WARMUP_CALENDAR_FACTOR = 1.6  # calendar days per trading bar, with margin
