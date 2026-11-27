"""Strategy-builder backtests: rule specs, multi-asset portfolios, sweeps and
robustness, run as background jobs.

    GET    /backtest/v2/meta              indicators, operators, presets, limits
    POST   /backtest/v2/validate          check a spec (422 with reasons)
    POST   /backtest/v2/jobs              start a job -> {id}
    GET    /backtest/v2/jobs/latest       the caller's newest job (re-attach), or null
    GET    /backtest/v2/jobs/{id}         status / progress / result
    DELETE /backtest/v2/jobs/{id}         cancel; ?forget=true also drops a finished result

Every handler is a plain ``def`` (threadpool) and none touches the DB. Auth
uses the JWT-only guard, so no DB connection is held. The work itself runs
in ``backtesting.jobs`` (a 1-thread pool with a queue and a time budget).
Job snapshots also go to Redis for 24 h, so a result survives leaving the
page, a reload, another device, or a backend restart.
"""
from __future__ import annotations

import copy
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import _guard_token
from app.services.backtesting import limits as L
from app.services.backtesting.indicators import INDICATORS
from app.services.backtesting.jobs import AlreadyRunning, QueueFull, manager
from app.services.backtesting.rules import OPS, PRESETS
from app.services.backtesting.runner import DISCLAIMER, RunRequest, run_strategy

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/backtest/v2/meta")
def backtest_meta():
    return {
        "indicators": [
            {"id": k, "description": d, "params": {p: {"type": t, "default": dv, "min": lo, "max": hi}
                                                    for p, (t, dv, lo, hi) in spec.items()}}
            for k, (spec, d) in INDICATORS.items()
        ],
        "operators": list(OPS),
        "presets": copy.deepcopy(PRESETS),
        "limits": {
            "max_symbols": L.MAX_SYMBOLS, "max_years": L.MAX_YEARS, "max_grid_combos": L.MAX_GRID_COMBOS,
            "max_param_values": L.MAX_PARAM_VALUES, "max_window": L.MAX_WINDOW, "max_conditions": L.MAX_CONDITIONS,
            "max_rule_depth": L.MAX_RULE_DEPTH, "max_mc_sims": L.MAX_MC_SIMS, "max_wf_folds": L.MAX_WF_FOLDS,
            "job_time_budget_s": L.JOB_TIME_BUDGET_S, "max_work_cells": L.MAX_WORK_CELLS,
        },
        "disclaimer": DISCLAIMER,
    }


@router.post("/backtest/v2/validate")
def validate_spec(req: RunRequest):
    from app.services.backtesting.rules import describe_group, grid_combos, warmup_bars

    s = req.spec
    base = dict(s.parameters)
    for k, v in s.param_grid.items():
        base.setdefault(k, v[0])
    return {"ok": True, "combinations": len(grid_combos(s)), "warmup_bars": warmup_bars(s),
            "rules_text": {"entry": describe_group(s.entry, base), "exit": describe_group(s.exit, base)}}


@router.post("/backtest/v2/jobs", status_code=202)
def start_job(req: RunRequest, user_id: int = Depends(_guard_token)):
    def work(progress, deadline, should_cancel):
        return run_strategy(req, progress=progress, deadline=deadline, should_cancel=should_cancel)

    try:
        job = manager.submit(str(user_id), work)
    except AlreadyRunning:
        raise HTTPException(status_code=409, detail="You already have a backtest running. Wait for it or cancel it.")
    except QueueFull:
        raise HTTPException(status_code=429, detail="The backtest queue is full. Try again in a minute.")
    return job.public(include_result=False)


@router.get("/backtest/v2/jobs/latest")
def latest_job(kind: Literal["lab", "classic"] = "lab", include_result: bool = True,
               user_id: int = Depends(_guard_token)):
    """The caller's newest job of ``kind`` (active first), so a page reopened
    on any device can re-attach. ``null`` when there is none."""
    return manager.latest_public(str(user_id), kind=kind, include_result=include_result)


@router.get("/backtest/v2/jobs/{job_id}")
def get_job(job_id: str, user_id: int = Depends(_guard_token)):
    job = manager.get_public(job_id, str(user_id))
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return job


@router.delete("/backtest/v2/jobs/{job_id}")
def cancel_job(job_id: str, forget: bool = False, user_id: int = Depends(_guard_token)):
    """Cancel an active job. With ``forget=true`` a finished job's stored
    result is dropped too (the Lab's Reset)."""
    owner = str(user_id)
    if forget:
        if not manager.forget(job_id, owner):
            raise HTTPException(status_code=404, detail="Job not found or expired")
        return manager.get_public(job_id, owner, include_result=False) or {"id": job_id, "status": "forgotten"}
    job = manager.cancel(job_id, owner)
    if job is not None:
        return job.public(include_result=False)
    snap = manager.get_public(job_id, owner, include_result=False)
    if snap is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return snap
