"""Answer composer for deep (institutional) questions.

The model writes the analysis; the server enforces the frame:

  ## Summary
  ## Data & Method          (formulas, inputs, assumptions as parameters)
  ## Results                (markdown tables, every figure cited)
  ## Interpretation
  ## Verified facts vs assumptions/interpretation
  ## Limitations
  ## Sources                (always rendered by the server from the fact registry)

``finalize`` runs after generation:
  1. drops whatever the model wrote under "Sources" and renders the real
     citation list (filing dates / accession / section / URL / as-of / formula)
     from the facts actually cited, so a citation can never be invented;
  2. numeric grounding in BLOCK mode: a figure that does not trace to a tool or
     context value is replaced by "n/a (unverified)" (after the engine has
     already given the model one chance to repair it);
  3. adds missing required sections, and in Limitations lists every planned
     computation that was not executed (no tool / tool failed), so an
     unavailable simulation can never read as if it had run;
  4. lists the assumptions that tools reported (ERP, terminal growth, shocks)
     under "Verified facts vs assumptions", labelled as assumptions.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services.copilot.postcheck import (CITE_RE, LEAK_MARKERS, POLICY_NOTE, fix_citations, ground_numbers,
                                            policy_filter)
from app.services.copilot.provenance import provenance_of
from app.services.copilot.registry import FactRegistry

SECTIONS: Tuple[Tuple[str, str], ...] = (
    ("summary", r"summary|executive summary|bottom line"),
    ("data_method", r"data\s*(?:&|and)\s*method(?:ology)?|method(?:ology)?|data\s*(?:&|and)\s*assumptions"),
    ("results", r"results?|findings"),
    ("interpretation", r"interpretation|analysis|discussion"),
    ("facts_vs_assumptions", r"verified facts.*|facts\s*vs\.?\s*assumptions.*|facts,? assumptions.*"),
    ("limitations", r"limitations?|caveats"),
    ("sources", r"sources|citations|references"),
)
TITLES = {"summary": "Summary", "data_method": "Data & Method", "results": "Results",
          "interpretation": "Interpretation",
          "facts_vs_assumptions": "Verified facts vs assumptions/interpretation",
          "limitations": "Limitations", "sources": "Sources"}
REQUIRED = [k for k, _ in SECTIONS]
_HEAD = re.compile(r"^(#{1,4})\s+(?:\d+[.)]\s*)?(.+?)\s*#*\s*$", re.M)
UNVERIFIED_TOKEN = "n/a (unverified)"
# Deep answers: a figure must equal a value a tool / context returned (display
# rounding + 0.1%), with no derived growth-rate / difference matches.
STRICT_GROUNDING = os.getenv("COPILOT_DEEP_STRICT_GROUNDING", "1").lower() not in ("0", "false", "no")

DEEP_PROMPT_ADDENDUM = """

Deep-analysis mode (long, multi-part questions)
- A <context source="plan"> block lists the computations and retrievals the question needs, the \
tools that perform each one, and its status. Steps marked planned still need a tool call: call the \
listed tools (independent calls in parallel, in the same turn). Do not repeat a call that already \
returned.
- Every number in the answer must come from a tool output or context block and be cited with its id. \
Never compute figures yourself beyond simple arithmetic you show with cited inputs; never recall \
figures from memory.
- Honesty: if a step is unavailable or failed, or a tool returned an error, say plainly that the \
computation was not executed and why. Do not fabricate simulation, backtest, regression or valuation \
results if execution is unavailable; do not present an estimate in their place.
- Assumptions (equity risk premium, terminal growth, scenario shocks, tax rate, costs) are parameters, \
not facts: state each with its value as reported by the tool and label it an assumption.
- Separate what filings/data state (verified facts) from your interpretation.
- Structure the answer with exactly these markdown headings, in order: ## Summary, ## Data & Method, \
## Results, ## Interpretation, ## Verified facts vs assumptions/interpretation, ## Limitations, \
## Sources. Data & Method names each formula used. Results uses markdown pipe tables \
(| Metric | Value | Source |) — the chat UI renders them. Under Sources write only the cited ids; \
the server renders the full citation list."""


def section_spans(text: str) -> List[Tuple[str, int, int, int]]:
    """(key, heading_start, body_start, end) for each recognised ## heading."""
    heads = []
    for m in _HEAD.finditer(text or ""):
        title = m.group(2).strip().strip("*").strip()
        key = next((k for k, rx in SECTIONS if re.fullmatch(rx, title, re.I)), None)
        heads.append((key, m.start(), m.end()))
    out = []
    for i, (key, hs, be) in enumerate(heads):
        end = heads[i + 1][1] if i + 1 < len(heads) else len(text)
        if key:
            out.append((key, hs, be, end))
    return out


def missing_sections(text: str) -> List[str]:
    have = {k for k, *_ in section_spans(text)}
    return [k for k in REQUIRED if k not in have]


def strip_sources(text: str) -> str:
    spans = [s for s in section_spans(text) if s[0] == "sources"]
    for _, hs, _, end in sorted(spans, key=lambda s: -s[1]):
        text = text[:hs].rstrip() + "\n\n" + text[end:].lstrip()
    return text.rstrip()


def _cell(v: Any) -> str:
    return str(v).replace("|", "/").replace("\n", " ")


def render_sources(registry: FactRegistry, cited: Sequence[str]) -> str:
    lines = []
    for n, fid in enumerate(cited, 1):
        f = registry.get(fid)
        if f is None:
            continue
        p = provenance_of(f)
        bits = [p.get("source") or f.kind]
        form = p.get("filing_type") or p.get("form")
        if form:
            bits.append(form)
        if p.get("section"):
            bits.append(f"section: {p['section']}")
        if p.get("period_label") or p.get("period"):
            bits.append(f"period: {p.get('period_label') or p.get('period')}")
        filed = p.get("filed_date") or p.get("filed")
        if filed:
            bits.append(f"filed {filed}")
        if p.get("accession"):
            bits.append(f"accession {p['accession']}")
        asof = p.get("observation_date") or p.get("published_at") or p.get("as_of")
        if asof:
            bits.append(f"as of {asof}")
        line = f"{n}. [{fid}] {f.label()} — " + "; ".join(_cell(b) for b in bits)
        if p.get("url"):
            line += f" — <{p['url']}>"
        formulas = p.get("formulas") or ({"formula": p["formula"]} if p.get("formula") else {})
        if formulas:
            line += "\n   - Formula: " + "; ".join(f"{k}: {_cell(v)}" for k, v in list(formulas.items())[:4])
        lines.append(line)
    if not lines:
        return "## Sources\n\nNo source data was cited in this answer."
    return "## Sources\n\n" + "\n".join(lines)


def tool_assumptions(registry: FactRegistry, cited: Sequence[str]) -> List[Tuple[str, str, Any]]:
    """(fact id, parameter, value) for assumptions reported by the cited tool outputs."""
    out = []
    for fid in cited:
        f = registry.get(fid)
        a = getattr(f, "assumptions", None) if f is not None else None
        if isinstance(a, dict):
            for k, v in a.items():
                out.append((fid, k, v))
    return out


@dataclass
class ComposeResult:
    text: str
    changed: bool
    cited_ids: List[str] = field(default_factory=list)
    invalid_citations: List[str] = field(default_factory=list)
    numbers_checked: int = 0
    unverified_numbers: List[str] = field(default_factory=list)
    removed_numbers: List[str] = field(default_factory=list)
    missing_sections: List[str] = field(default_factory=list)
    added_sections: List[str] = field(default_factory=list)
    not_executed: List[str] = field(default_factory=list)
    policy_flags: List[str] = field(default_factory=list)
    leak_blocked: bool = False

    def summary(self) -> Dict[str, Any]:
        return {"cited_ids": self.cited_ids, "invalid_citations": self.invalid_citations,
                "numbers_checked": self.numbers_checked, "unverified_numbers": self.unverified_numbers,
                "removed_numbers": self.removed_numbers, "missing_sections": self.missing_sections,
                "added_sections": self.added_sections, "not_executed": self.not_executed,
                "policy_flags": self.policy_flags, "leak_blocked": self.leak_blocked, "changed": self.changed,
                "mode": "deep"}


def untraceable(text: str, registry: FactRegistry, question: str = "") -> List[str]:
    """Figures in the answer that do not match any tool / context value."""
    body = strip_sources(text)
    _, _, bad = ground_numbers(body, registry, question, strict=STRICT_GROUNDING)
    return bad


def block_numbers(text: str, registry: FactRegistry, question: str) -> Tuple[str, int, List[str]]:
    """Replace every untraceable figure with UNVERIFIED_TOKEN."""
    return ground_numbers(text, registry, question, block_with=UNVERIFIED_TOKEN, strict=STRICT_GROUNDING)


def _limitations_block(existing: str, not_executed: List[str], removed: List[str]) -> str:
    lines = []
    for n in not_executed:
        lines.append(f"- Not executed: {n}. No result is reported for it, and nothing was estimated in its place.")
    if removed:
        lines.append(f"- {len(removed)} figure(s) could not be traced to a tool output and were removed "
                     f"(shown as \"{UNVERIFIED_TOKEN}\").")
    return "\n".join(lines)


def finalize(text: str, registry: FactRegistry, question: str, plan=None) -> ComposeResult:
    original = text
    if any(m in text for m in LEAK_MARKERS):
        return ComposeResult(text="I can't share my internal instructions. Ask me about a ticker, its "
                                  "financials, filings or risk instead.", changed=True, leak_blocked=True)
    missing_before = missing_sections(text)
    t = strip_sources(text)
    t, cited, invalid = fix_citations(t, registry)
    t, flags = policy_filter(t)
    t, checked, removed = block_numbers(t, registry, question)

    not_executed: List[str] = []
    if plan is not None:
        for s in plan.steps:
            if s.status in ("unavailable", "failed"):
                why = "no tool available" if s.status == "unavailable" else (s.errors[0] if s.errors else "tool failed")
                not_executed.append(f"{s.need} ({why})")

    # assumptions reported by tools, labelled as such
    spans = {k: (hs, be, end) for k, hs, be, end in section_spans(t)}
    assumptions = tool_assumptions(registry, cited)
    added: List[str] = []
    if "facts_vs_assumptions" in spans:
        _, be, end = spans["facts_vs_assumptions"]
        sec = t[be:end].lower()
        # only the assumptions the model did not already state
        assumptions = [a for a in assumptions if a[1].lower() not in sec and a[1].replace("_", " ").lower() not in sec]
    if assumptions:
        block = "**Assumptions reported by the tools (parameters, not facts):**\n" + "\n".join(
            f"- {k}: {_cell(v)} [{fid}]" for fid, k, v in assumptions[:20])
        if "facts_vs_assumptions" in spans:
            _, be, end = spans["facts_vs_assumptions"]
            t = t[:end].rstrip() + "\n\n" + block + "\n\n" + t[end:].lstrip()
        else:
            t = t.rstrip() + f"\n\n## {TITLES['facts_vs_assumptions']}\n\n" + block
            added.append("facts_vs_assumptions")

    lim = _limitations_block(t, not_executed, removed)
    spans = {k: (hs, be, end) for k, hs, be, end in section_spans(t)}
    if lim:
        if "limitations" in spans:
            _, be, end = spans["limitations"]
            t = t[:end].rstrip() + "\n" + lim + "\n\n" + t[end:].lstrip()
        else:
            t = t.rstrip() + f"\n\n## {TITLES['limitations']}\n\n" + lim
            added.append("limitations")

    still_missing = [k for k in missing_sections(t) if k != "sources"]
    for k in still_missing:
        if k == "summary":
            continue                                  # never fabricate a summary
        t = t.rstrip() + f"\n\n## {TITLES[k]}\n\n_Not provided in this answer._"
        added.append(k)
    if flags:
        t = t.rstrip() + "\n\n" + POLICY_NOTE
    t = t.rstrip() + "\n\n" + render_sources(registry, cited)
    return ComposeResult(text=t, changed=t != original, cited_ids=cited, invalid_citations=invalid,
                         numbers_checked=checked, unverified_numbers=removed, removed_numbers=removed,
                         missing_sections=missing_before, added_sections=added, not_executed=not_executed,
                         policy_flags=flags)


def repair_instruction(untraced: Sequence[str], missing: Sequence[str], plan=None) -> str:
    parts = ["Revise your previous answer and return the COMPLETE corrected answer (no preamble)."]
    if untraced:
        parts.append("These figures do not match any tool output or context value: "
                     + ", ".join(f'"{u}"' for u in list(untraced)[:25])
                     + ". For each one either replace it with the exact value from a tool output and cite "
                       "its id, or write \"unavailable\". Do not keep figures that no tool produced.")
    if missing:
        parts.append("Add the missing sections: " + ", ".join(TITLES[m] for m in missing) + ".")
    if plan is not None and plan.unavailable:
        parts.append("These steps were NOT executed; say so and report no results for them: "
                     + "; ".join(s.need for s in plan.unavailable) + ".")
    return " ".join(parts)
