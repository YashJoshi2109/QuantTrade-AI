"""Async report jobs API: Console-style statements and data reports.

Heavy read-only SQL runs off the request path (app.services.reports.runner):

* ``GET    /reports/tasks``                 tasks you can run and their args
* ``POST   /reports/tasks/{name}/jobs``     queue a job (202); a fresh identical
                                            result comes back at once (``cached``)
* ``GET    /reports/jobs/{id}``             status, plus a page of rows when done
* ``GET    /reports/jobs/{id}/csv``         the full result as CSV
* ``DELETE /reports/jobs/{id}``             cancel a pending job / delete a result

All routes need a signed-in user. User-scoped tasks only ever read the caller's
own rows: the runner binds ``:user_id`` from the token, not from the request.
"""
from __future__ import annotations

import csv
import io
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.auth import _guard_token
from app.api.portfolios import _csv_cell
from app.services.reports.registry import ArgError
from app.services.reports.runner import QueueFull, TooManyActive, UnknownTask, runner

router = APIRouter(prefix="/reports", tags=["reports"])


class JobRequest(BaseModel):
    args: Dict[str, Any] = Field(default_factory=dict)


@router.get("/tasks")
def list_report_tasks(user_id: int = Depends(_guard_token)):
    return {"tasks": runner.list_tasks()}


@router.post("/tasks/{name}/jobs", status_code=202)
def submit_report_job(name: str, body: JobRequest, user_id: int = Depends(_guard_token)):
    try:
        return runner.submit(name, user_id, body.args)
    except UnknownTask:
        raise HTTPException(status_code=404, detail=f"Unknown report {name!r}")
    except ArgError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TooManyActive:
        raise HTTPException(status_code=409, detail="You already have reports running. Wait for one to finish.")
    except QueueFull:
        raise HTTPException(status_code=429, detail="The report queue is full. Try again in a minute.")


@router.get("/jobs/{job_id}")
def get_report_job(
    job_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
    user_id: int = Depends(_guard_token),
):
    out = runner.get(job_id, user_id, offset=offset, limit=limit)
    if out is None:
        raise HTTPException(status_code=404, detail="Report not found or expired")
    return out


@router.get("/jobs/{job_id}/csv")
def download_report_csv(job_id: str, user_id: int = Depends(_guard_token)):
    res = runner.full_result(job_id, user_id)
    if res is None:
        raise HTTPException(status_code=404, detail="Report not found, expired, or not finished")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(res["columns"])
    # Portfolio names are user text: neutralise spreadsheet formula injection.
    w.writerows([[_csv_cell(v) for v in r] for r in res["rows"]])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{res["task"]}.csv"',
                 "X-Report-Truncated": "1" if res["truncated"] else "0"},
    )


@router.delete("/jobs/{job_id}")
def cancel_report_job(job_id: str, user_id: int = Depends(_guard_token)):
    out = runner.cancel(job_id, user_id)
    if out is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return out
