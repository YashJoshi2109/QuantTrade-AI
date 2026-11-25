"""
News intelligence pipeline.

ingest (pollers + Alpaca/Benzinga stream) -> dedupe/cluster -> classify
(FinBERT sentiment, rule+embedding categories, tickers, impact) -> news_items
table -> Redis pub/sub `qt:ws:news` -> WebSocket /api/v1/ws/news.

A slow path adds Claude Haiku "why it matters" notes to the highest-impact
clusters under a hard daily cap.

Modules:
  categories  — category taxonomy, high-precision regex rules, embedding seeds
  sentiment   — shared FinBERT classifier (keyword fallback only if the model fails)
  categorizer — rules first, MiniLM nearest-centroid for the rest
  tickers     — provider symbols + cashtags + company-name match
  impact      — 0-100 impact score
  dedupe      — canonical URL / title hash + near-duplicate clustering
  sources     — RSS/Finnhub/SEC pollers and the Alpaca news WebSocket
  store       — news_items persistence + feed queries
  ai_notes    — capped Claude Haiku notes
  pipeline    — the asyncio service started from main.py lifespan
"""
