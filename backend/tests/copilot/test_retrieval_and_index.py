"""Ticker-scoped retrieval + SEC index invariants (Qdrant mocked)."""
import asyncio
from types import SimpleNamespace

import pytest

from app.services.copilot import bm25, retrieval, sec_index


def test_bm25_encodes_deterministically():
    i1, v1 = bm25.encode_document("Revenue increased; revenues grew. Revenue!")
    i2, _ = bm25.encode_document("Revenue increased; revenues grew. Revenue!")
    assert i1 == i2 and len(i1) == len(v1) and all(v > 0 for v in v1)
    qi, qv = bm25.encode_query("the revenue")
    assert qi and set(qi) <= set(i1) and qv == [1.0] * len(qi)


def test_search_without_ticker_never_queries():
    assert asyncio.run(retrieval.search_filings("risk factors", [])) == []


def test_filter_always_contains_ticker():
    f = retrieval._filter(["tsla"], None, None)
    assert f.must[0].key == "ticker" and f.must[0].match.any == ["TSLA"]


def _hit(i, ticker, model="openai:text-embedding-3-small:1536", filed="2026-01-29"):
    return retrieval.Hit(i, {"ticker": ticker, "embed_model": model, "filed_date": filed, "text": f"text {i}",
                             "parent_id": None, "filing_type": "10-K", "section": "Risk Factors",
                             "accession": "a", "fiscal_year": 2025}, 1.0)


def test_off_ticker_and_model_drift_dropped(monkeypatch):
    monkeypatch.setenv("EMBED_MODEL", "openai:text-embedding-3-small:1536")
    from app.services.agentic import bedrock_client as bc
    monkeypatch.setattr(bc, "embed_query", lambda q: [0.1] * 1536)
    monkeypatch.setattr(bc, "rerank_configured", lambda: False)
    monkeypatch.setattr(retrieval, "_dense", lambda v, f, n: [_hit("a", "TSLA"), _hit("b", "AMZN"),
                                                             _hit("c", "TSLA", model="bedrock:titan:1024")])
    monkeypatch.setattr(retrieval, "_sparse", lambda i, v, f, n: [_hit("d", "TSLA")])
    monkeypatch.setattr(retrieval, "_parents", lambda ids: {})
    out = asyncio.run(retrieval.search_filings("risk", ["TSLA"], limit=5))
    assert {c.ticker for c in out} == {"TSLA"}
    assert {c.id for c in out} == {"filing:a", "filing:d"}


def test_recency_decay_orders_newer_first():
    assert retrieval.recency_weight("2026-11-01") > retrieval.recency_weight("2022-11-01")


def _meta():
    return sec_index.FilingMeta(ticker="TSLA", cik="1", accession="0001-26-1", filing_type="10-K",
                                filed_date="2026-01-29", fiscal_year=2025)


TEXT = ("Item 1A. Risk Factors. " + " ".join(f"Risk sentence number {i} about demand and costs." for i in range(120))
        + " Item 7. Management's Discussion. " + " ".join(f"Revenue sentence {i} grew." for i in range(60)))


def test_chunk_ids_are_content_hashes():
    c1, p1 = sec_index.chunk_filing(TEXT, _meta())
    c2, p2 = sec_index.chunk_filing(TEXT, _meta())
    assert [c.id for c in c1] == [c.id for c in c2] and len(c1) > 2 and p1
    assert {c.section for c in c1} >= {"Risk Factors", "MD&A"}


class FakeQdrant:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.upserts = []

    def retrieve(self, coll, ids, with_payload=False, with_vectors=False):
        return [SimpleNamespace(id=i) for i in ids if i in self.existing]

    def upsert(self, coll, points):
        self.upserts.append((coll, points))
        self.existing.update(p.id for p in points)


def test_index_skips_existing_and_refuses_zero_vectors(monkeypatch):
    spec = SimpleNamespace(dim=4, key="openai:test:4")
    q = FakeQdrant()
    monkeypatch.setattr(sec_index, "qdrant", lambda: q)
    embed_calls = []

    def embed(texts):
        embed_calls.append(len(texts))
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]

    n = sec_index.index_filing(TEXT, _meta(), embed, spec)
    assert n > 0
    pts = [p for c, ps in q.upserts if c == sec_index.CHUNKS_COLLECTION for p in ps]
    assert all(p.payload["embed_model"] == "openai:test:4" and p.payload["embed_dim"] == 4 for p in pts)
    assert all(sec_index.SPARSE in p.vector for p in pts)
    # re-ingest: everything exists -> no embedding call, nothing written
    before = len(embed_calls)
    assert sec_index.index_filing(TEXT, _meta(), embed, spec) == 0 and len(embed_calls) == before

    q2 = FakeQdrant()
    monkeypatch.setattr(sec_index, "qdrant", lambda: q2)
    with pytest.raises(RuntimeError, match="refusing"):
        sec_index.index_filing(TEXT, _meta(), lambda ts: [[0.0] * 4 for _ in ts], spec)
    with pytest.raises(RuntimeError, match="refusing"):
        sec_index.index_filing(TEXT, _meta(), lambda ts: [[0.1] * 3 for _ in ts], spec)
    assert not q2.upserts


def test_sec_refresh_selects_only_new_accessions():
    from app.services.copilot.sec_refresh import select_new
    F = lambda acc, form, d: SimpleNamespace(accession_num=acc, filing_type=form, filed_date=d)
    fl = [F("k1", "10-K", "2026-01-29"), F("k0", "10-K", "2025-01-29"), F("q3", "10-Q", "2026-10-22"),
          F("q2", "10-Q", "2026-07-22"), F("q1", "10-Q", "2026-04-22"), F("q0", "10-Q", "2025-10-22"),
          F("s", "S-8", "2026-05-01")]
    first = [f.accession_num for f in select_new(fl, set(), first_run=True)]
    assert first == ["q3", "q2", "q1", "k1"]
    later = [f.accession_num for f in select_new(fl, {"k1", "q3", "q2", "q1", "q0", "k0"}, first_run=False)]
    assert later == []
