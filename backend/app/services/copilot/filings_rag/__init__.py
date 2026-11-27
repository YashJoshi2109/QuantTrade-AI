"""SEC filings retrieval with verbatim citations for the copilot.

Pipeline (all deterministic, no LLM anywhere):

  edgar.py        EDGAR access: declared User-Agent, process-wide rate limit
                  (<10 req/s, SEC fair access), disk cache (+ the shared S3
                  JSON cache keys used by sec_edgar_service)
  parse.py        filing HTML -> normalized text with per-line offsets,
                  emphasis (bold/italic headings), HTML anchors and page breaks;
                  10-K / 10-Q / 8-K item sectioning
  index.py        section-bounded chunks + Okapi BM25 (optionally fused with
                  the Qdrant hybrid index when it is configured)
  diff.py         cross-filing section diff (added / removed / changed units)
  disclosures.py  topic extractors combining XBRL companyfacts values (filed
                  in that accession) with the narrative excerpt
  facts.py        citable Fact types (every excerpt is doc.text[start:end])
  tools.py        copilot tool specs + dispatch

Every excerpt returned is an exact slice of the normalized filing text
(whitespace collapsed, table cells joined by a space); ``verify_excerpt``
re-checks that invariant.
"""
