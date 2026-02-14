import datetime as _dt

from app.models.filing import Filing, FilingChunk
from app.models.news import NewsArticle


def test_filing_chunk_has_required_fields():
    chunk = FilingChunk(
        filing=Filing(
            symbol_id=1,
            filing_type="10-K",
            form_type="10-K",
            filing_date=_dt.datetime.now(_dt.timezone.utc),
        ),
        chunk_index=0,
        content="Test content",
        section="Risk Factors",
    )

    assert chunk.content
    assert chunk.section


def test_news_article_has_basic_fields():
    article = NewsArticle(
        symbol_id=1,
        title="Test headline",
        source="UnitTest",
        url="https://example.com",
    )
    assert article.title
    assert article.source
    assert article.url

