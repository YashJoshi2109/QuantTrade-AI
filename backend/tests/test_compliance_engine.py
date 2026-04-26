import pytest
from app.services.compliance_engine import ComplianceEngine, compliance_engine

@pytest.fixture
def engine():
    return ComplianceEngine()

class TestStage1Regex:
    def test_blocks_buy_now(self, engine):
        result = engine.stage1_regex("You should buy now before it's too late")
        assert result.action == "block"
        assert result.stage == 1
        assert len(result.flags) > 0

    def test_blocks_will_go_up(self, engine):
        result = engine.stage1_regex("This stock will go up 50% next quarter")
        assert result.action == "block"

    def test_blocks_guaranteed_return(self, engine):
        result = engine.stage1_regex("This offers a guaranteed return of 20%")
        assert result.action == "block"

    def test_allows_analysis(self, engine):
        result = engine.stage1_regex(
            "Based on the P/E ratio of 22 and revenue growth of 15%, "
            "AAPL appears undervalued relative to sector peers."
        )
        assert result.action == "allow"

    def test_allows_factual(self, engine):
        result = engine.stage1_regex(
            "Apple reported Q3 revenue of $85B, up 8% YoY. "
            "EPS came in at $1.26 vs $1.21 consensus."
        )
        assert result.action == "allow"

    def test_case_insensitive(self, engine):
        result = engine.stage1_regex("STRONG BUY signal detected")
        assert result.action == "block"

    def test_flags_deduped(self, engine):
        result = engine.stage1_regex("buy now buy now buy now")
        assert len(result.flags) == 1  # deduped

class TestClassify:
    @pytest.mark.asyncio
    async def test_classify_blocks_advice(self, engine):
        result = await engine.classify("You should sell immediately")
        assert result.action == "block"

    @pytest.mark.asyncio
    async def test_classify_allows_analysis(self, engine):
        result = await engine.classify("Revenue growth looks solid at 12% YoY")
        assert result.action == "allow"

class TestDisclosure:
    def test_disclosure_appended(self, engine):
        body = "AAPL Q3 revenue beat expectations."
        result = engine.append_disclosure(body, "MarketRecap", "@MarketRecap", post_id=42)
        assert "Not investment advice" in result
        assert "@MarketRecap" in result
        assert "/agora/post/42/provenance" in result

    def test_disclosure_post_id_none(self, engine):
        result = engine.append_disclosure("text", "Bot", "@Bot", post_id=None)
        assert "Not investment advice" in result
        assert "/agora/post/new/provenance" in result
