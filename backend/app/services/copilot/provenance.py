"""Generic provenance-carrying fact for computed tool outputs.

Engines may return their own Fact subclasses; this one exists so any tool
(including recorded tools in the eval harness) can hand back a deterministic
computation together with everything the answer needs to cite it:

  values       metric -> number (None = could not be computed; say so)
  formulas     metric -> formula text ("ROIC = NOPAT / invested capital")
  assumptions  parameter -> value, e.g. {"equity_risk_premium": 0.05}; these are
               ASSUMPTIONS, not facts, and the composer labels them that way
  inputs       where the inputs came from (filing accession / section / URL,
               price series, FRED series) with their as-of dates
  unavailable  metric -> reason it is not available

The id is deterministic (tool + ticker + args hash) so citations survive
caching and replay.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from app.services.copilot.models import Fact


class ComputedFact(Fact):
    kind: Literal["computed"] = "computed"
    tool: str
    title: Optional[str] = None
    values: Dict[str, Optional[float]] = Field(default_factory=dict)
    formulas: Dict[str, str] = Field(default_factory=dict)
    assumptions: Dict[str, Any] = Field(default_factory=dict)
    table: List[Dict[str, Any]] = Field(default_factory=list)
    inputs: List[Dict[str, Any]] = Field(default_factory=list)
    unavailable: Dict[str, str] = Field(default_factory=dict)
    filing_type: Optional[str] = None
    filed_date: Optional[str] = None
    accession: Optional[str] = None
    section: Optional[str] = None
    url: Optional[str] = None
    period: Optional[str] = None
    note: Optional[str] = None

    def label(self) -> str:
        return self.title or f"{self.ticker or ''} {self.tool}".strip()

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        vals = [f"{k} {_fmt(v)}" for k, v in list(self.values.items())[:6] if v is not None]
        d.update(tool=self.tool, filing_type=self.filing_type, filed_date=self.filed_date,
                 accession=self.accession, section=self.section, url=self.url, period=self.period,
                 formulas=dict(list(self.formulas.items())[:6]) or None,
                 assumptions=self.assumptions or None,
                 snippet="; ".join(vals) + ("." if vals else "") + (f" {self.note}" if self.note else ""))
        return {k: v for k, v in d.items() if v is not None}


def _fmt(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:,.4g}" if abs(v) < 1e4 else f"{v:,.0f}"
    return str(v)


def fact_id(tool: str, ticker: Optional[str], args: Optional[Dict[str, Any]] = None) -> str:
    h = hashlib.sha1(json.dumps(args or {}, sort_keys=True, default=str).encode()).hexdigest()[:8]
    return f"calc:{tool}:{(ticker or 'all').upper()}:{h}"


def computed_fact(tool: str, ticker: Optional[str], *, source: str, as_of: Optional[str],
                  args: Optional[Dict[str, Any]] = None, **fields: Any) -> ComputedFact:
    return ComputedFact(id=fields.pop("id", None) or fact_id(tool, ticker, args), tool=tool, ticker=ticker,
                        source=source, as_of=as_of, **fields)


def provenance_of(f: Fact) -> Dict[str, Any]:
    """Citation-grade provenance of ANY fact (built-in kinds, ComputedFact, or
    an engine's own subclass): only the fields that exist and are set."""
    d = f.model_dump(exclude_none=True)
    keys = ("source", "as_of", "filing_type", "form", "filed_date", "filed", "accession", "section",
            "url", "period", "period_label", "observation_date", "series", "published_at", "publisher")
    out = {k: d[k] for k in keys if d.get(k) not in (None, "", [], {})}
    for k in ("formulas", "formula", "assumptions", "inputs"):
        if d.get(k):
            out[k] = d[k]
    return out
