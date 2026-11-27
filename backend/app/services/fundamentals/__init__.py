"""Fundamentals / financial-statements engine.

Deterministic, provenance-carrying analytics over SEC XBRL companyfacts:

* ``xbrl``     normalised annual + quarterly income statement, balance sheet
               and cash-flow series (tag aliases, restatements, fiscal-year
               ends, units, duplicate frames, YTD -> quarter derivation).
* ``metrics``  accruals, working capital, ROIC, DuPont, Altman Z / Z'',
               Piotroski F, Beneish M, coverage, liquidity, debt maturities,
               FCF sustainability, per-share (buyback/dilution) decomposition.
* ``wacc``     CAPM WACC with every input explicit (pluggable provider so the
               valuation engine's WACC can be used instead).
* ``peers``    peer comparison table + transparent rank and rank sensitivity.
* ``analysis`` assembles the copilot tool payloads.

No number here comes from an LLM; every figure is computed from filed XBRL
values (with accession / form / filing date) or a named market-data source.
"""
