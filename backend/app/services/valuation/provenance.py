"""Provenance primitives shared by every valuation module."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


class DataUnavailable(LookupError):
    """A required input is missing. The message says exactly what and why;
    callers surface it to the user instead of substituting a value."""


@dataclass
class Datum:
    """One input value and where it came from."""
    value: float
    source: str                        # e.g. "SEC XBRL companyfacts"
    as_of: Optional[str] = None        # period end / observation date / quote time
    tag: Optional[str] = None          # XBRL concept(s) or series id
    accession: Optional[str] = None    # SEC filing accession number
    form: Optional[str] = None         # 10-K / 20-F / 10-Q
    filed: Optional[str] = None
    formula: Optional[str] = None      # set when the value is derived
    unit: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Assumption:
    """An input that is NOT a verified fact: a documented default or a value
    the caller supplied. Always reported back in the output."""
    name: str
    value: Any
    rationale: str
    kind: str = "assumption"           # "assumption" | "derived_default" | "user_input"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AssumptionLog:
    items: List[Assumption] = field(default_factory=list)

    def add(self, name: str, value: Any, rationale: str, kind: str = "assumption") -> Any:
        self.items = [a for a in self.items if a.name != name]
        self.items.append(Assumption(name, value, rationale, kind))
        return value

    def to_list(self) -> List[Dict[str, Any]]:
        return [a.to_dict() for a in self.items]


def r(x: Optional[float], nd: int = 4) -> Optional[float]:
    """Round for output (None-safe). Internal math always uses full precision."""
    if x is None:
        return None
    return round(float(x), nd)


def pct(x: Optional[float], nd: int = 2) -> Optional[float]:
    """Fraction -> percent for output."""
    return None if x is None else round(float(x) * 100.0, nd)
