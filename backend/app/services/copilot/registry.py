"""FactRegistry: every fact shown to the model in this request, by id.

Used to (a) validate ``[id]`` citations in the answer, (b) collect the numeric
values the answer is allowed to contain (numeric grounding), (c) enforce
ticker scope (no fact from an unrequested company), (d) render citation chips.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Set

from pydantic import BaseModel

from app.services.copilot.models import Fact

_NUM_IN_TEXT = re.compile(r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(%|percent|billion|million|thousand|trillion|bn|mm|[bmkt]\b)?", re.I)
_UNIT = {"%": 1, "percent": 1, "billion": 1e9, "bn": 1e9, "b": 1e9, "million": 1e6, "mm": 1e6, "m": 1e6,
         "thousand": 1e3, "k": 1e3, "trillion": 1e12, "t": 1e12}


def numbers_in_text(text: str) -> List[float]:
    out = []
    for m in _NUM_IN_TEXT.finditer(text or ""):
        base = float(m.group(1).replace(",", "") + ("." + m.group(2) if m.group(2) else ""))
        unit = (m.group(3) or "").lower()
        out.append(base)
        if unit and unit not in ("%", "percent"):
            out.append(base * _UNIT.get(unit, 1))
    return out


def _walk(x: Any) -> Iterable[float]:
    if isinstance(x, bool):
        return
    if isinstance(x, (int, float)):
        yield float(x)
    elif isinstance(x, dict):
        for v in x.values():
            yield from _walk(v)
    elif isinstance(x, (list, tuple)):
        for v in x:
            yield from _walk(v)
    elif isinstance(x, str):
        yield from numbers_in_text(x)
    elif isinstance(x, BaseModel):
        yield from _walk(x.model_dump())


class FactRegistry:
    def __init__(self) -> None:
        self.facts: Dict[str, Fact] = {}
        self.extra_numbers: List[float] = []

    def add(self, fact: Optional[Fact]) -> None:
        if fact is not None:
            self.facts[fact.id] = fact

    def add_all(self, facts: Iterable[Fact]) -> None:
        for f in facts:
            self.add(f)

    def __contains__(self, fid: str) -> bool:
        return fid in self.facts

    def get(self, fid: str) -> Optional[Fact]:
        return self.facts.get(fid)

    def ids(self) -> Set[str]:
        return set(self.facts)

    def tickers(self) -> Set[str]:
        return {f.ticker for f in self.facts.values() if f.ticker}

    def numeric_values(self) -> List[float]:
        vals = list(self.extra_numbers)
        for f in self.facts.values():
            vals.extend(_walk(f.model_dump(exclude={"id", "ticker"})))
        return vals
