"""Deterministic valuation engine (WACC, 3-stage DCF, reverse DCF, Monte Carlo,
scenario / stress analysis, bank interest-rate sensitivity).

Design rules (the copilot depends on them):

* Every number is computed here from real inputs (SEC XBRL companyfacts, the
  canonical quote, daily price bars, FRED / Treasury rates). The LLM never
  produces a number; it only cites what these functions return.
* Every input carries provenance (``Datum``: source, as-of, accession, tag,
  formula) and every output lists its assumptions separately from its facts.
* Missing data raises ``DataUnavailable`` with an explicit reason. Nothing is
  silently defaulted: when an assumption replaces a missing input, the output
  says so in ``assumptions`` with ``kind="assumption"``.

The math modules (wacc, dcf, reverse_dcf, montecarlo, scenarios, banks) are
pure and network-free; ``data`` holds the live adapters.
"""
