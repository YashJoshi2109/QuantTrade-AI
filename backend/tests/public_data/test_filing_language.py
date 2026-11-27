"""Filing language metrics over the filings RAG pipeline (synthetic filings, fake EDGAR)."""
from collections import Counter

import pytest

from app.models.public_data import FilingLanguageMetric
from app.services.copilot.filings_rag import edgar
from app.services.copilot.filings_rag.store import FilingsService
from app.services.public_data import filing_language as FL

from copilot import filings_fixtures as F       # tests/ is on sys.path (pytest rootdir import mode)


@pytest.fixture
def svc():
    p = F.FakeEdgar()
    edgar.set_provider(p)
    yield FilingsService(p)
    edgar.set_provider(None)


def test_text_metrics_known_values():
    m = FL.text_metrics("The company recorded a loss. Litigation may adversely affect results.")
    assert m["words"] == 10 and m["sentences"] == 2
    assert m["negative"] == 2 and m["litigious"] == 1 and m["uncertainty"] == 1
    # Fog from the documented formula: complex = company, recorded, litigation, adversely
    assert m["fog"] == pytest.approx(0.4 * (10 / 2 + 100 * 4 / 10), abs=0.01)
    assert FL.text_metrics("")["words"] == 0


def test_syllables_and_cosine():
    assert FL.syllables("company") == 3 and FL.syllables("risk") == 1 and FL.syllables("reduced") == 2
    a = Counter({"supply": 2, "wafer": 1})
    assert FL.cosine(a, a) == 1.0 and FL.cosine(a, Counter({"china": 3})) == 0.0
    assert FL.cosine(a, Counter()) is None


def test_lm_dictionary_not_used():
    # own short lists, documented in the module (LM needs a commercial licence)
    assert all(len(v) < 120 for v in FL.WORD_LISTS.values())
    assert "Loughran" in FL.__doc__


def test_compute_ticker_stores_feature_rows(svc, db):
    res = FL.compute_ticker(db, "NVDA", per_form=2, svc=svc)
    assert res["rows"] > 0, res
    rows = db.query(FilingLanguageMetric).filter_by(ticker="NVDA", section="risk_factors").all()
    by_acc = {r.accession: r for r in rows}
    k25 = by_acc[F.ACC_K25]
    assert k25.form == "10-K" and k25.prev_accession == F.ACC_K24
    # FY2025 risk factors edited one paragraph and added one: similar but not identical
    assert 0.6 < k25.similarity_prev < 1.0
    assert k25.words > 50 and k25.fog is not None and k25.method_version == FL.METHOD_VERSION
    assert k25.available_at is not None and k25.source.startswith("QuantTrade text metrics")
    p = FL.language_payload(db, "NVDA")
    assert p["status"] == "ok" and p["filings"][0]["sections"]
    assert p["attribution"]["text"].startswith("Source: SEC")
    again = FL.compute_ticker(db, "NVDA", per_form=2, svc=svc)
    assert again["rows"] == 0                       # nothing recomputed
