"""
SEC filings fetcher and parser.

Phase 2: integrate with sec-api.io so we use **real** SEC filings
instead of mock data. This module uses:
- Query API  (https://api.sec-api.io) for recent filings metadata
- Download API / EDGAR mirror (https://edgar-mirror.sec-api.io) for content
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional
import re

import requests
from sqlalchemy.orm import Session

from app.config import settings
from app.models.filing import Filing, FilingChunk
from app.models.symbol import Symbol
from app.models.sec_usage import SecAPIUsage


class FilingsFetcher:
    """Fetches and processes SEC filings"""
    
    SEC_QUERY_ENDPOINT = "https://api.sec-api.io"
    SEC_DOWNLOAD_MIRROR = "https://edgar-mirror.sec-api.io"
    
    def __init__(self):
        self.user_agent = "TradingCopilot/1.0 (contact@example.com)"  # SEC requires user agent
    
    def get_cik_for_symbol(self, symbol: str) -> Optional[str]:
        """Get CIK (Central Index Key) for a ticker symbol"""
        # In production, use SEC API or local mapping
        # For Phase 2, return mock CIK
        cik_map = {
            "AAPL": "0000320193",
            "MSFT": "0000789019",
            "GOOGL": "0001652044",
            "AMZN": "0001018724",
            "TSLA": "0001318605",
            "META": "0001326801",
            "NVDA": "0001045810",
            "JPM": "0000019617",
            "V": "0001403161",
            "JNJ": "0000200406"
        }
        return cik_map.get(symbol.upper())

    # ------------------------------------------------------------------
    # Real SEC API integration (sec-api.io)
    # ------------------------------------------------------------------

    def _has_sec_api_key(self) -> bool:
        return bool(getattr(settings, "SEC_API_KEY", None))

    def _sec_query(self, payload: Dict, *, db: Session | None = None, user_id: int | None = None, tier: str | None = None) -> Dict:
        """
        Call sec-api.io Filing Query API.
        """
        if not self._has_sec_api_key():
            raise RuntimeError("SEC_API_KEY is not configured.")

        token = settings.SEC_API_KEY
        url = f"{self.SEC_QUERY_ENDPOINT}?token={token}"

        # Optional: enforce per-user daily quotas when DB + user context are provided.
        if db is not None:
            today = datetime.utcnow().date()
            usage = (
                db.query(SecAPIUsage)
                .filter(
                    SecAPIUsage.user_id == user_id,
                    SecAPIUsage.request_date == today,
                )
                .first()
            )

            # Determine per-user daily cap based on tier
            if tier == "paid":
                per_user_cap = 10
            elif tier == "authenticated":
                per_user_cap = 2
            else:
                per_user_cap = 1

            current_count = usage.request_count if usage else 0
            if current_count >= per_user_cap:
                raise RuntimeError("SEC API daily quota exceeded for this user.")

            # Increment usage counter optimistically
            if usage:
                usage.request_count = current_count + 1
                usage.updated_at = datetime.utcnow()
            else:
                usage = SecAPIUsage(
                    user_id=user_id,
                    tier=tier or "anonymous",
                    request_date=today,
                    request_count=1,
                )
                db.add(usage)
            db.commit()

        resp = requests.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        return resp.json()

    def _download_filing_content(self, url: str) -> str:
        """
        Download filing HTML/TXT content using the sec-api.io EDGAR mirror.

        Accepts either a sec.gov Archives URL or an already-mirrored URL.
        """
        if not self._has_sec_api_key() or not url:
            return ""

        token = settings.SEC_API_KEY
        # Replace original SEC host with mirror host
        mirror_url = url.replace("https://www.sec.gov", self.SEC_DOWNLOAD_MIRROR)
        # Append token (keep existing query if any)
        sep = "&" if "?" in mirror_url else "?"
        mirror_url = f"{mirror_url}{sep}token={token}"

        try:
            resp = requests.get(mirror_url, timeout=20)
            resp.raise_for_status()
            return resp.text
        except Exception:
            return ""

    def fetch_secapi_filings(self, symbol: str, count: int = 5, *, db: Session | None = None, user_id: int | None = None, tier: str | None = None) -> List[Dict]:
        """
        Fetch recent real filings for a symbol using sec-api.io.

        Returns a list of dicts compatible with ``save_filing_to_db``:
        - form_type
        - filing_date (datetime)
        - period_end_date (optional datetime)
        - accession_number
        - url
        - content
        - summary
        """
        if not self._has_sec_api_key():
            # Fallback to mock caller if key is missing
            return self.fetch_mock_filings(symbol, count=count)

        query = f"ticker:{symbol.upper()}"
        payload = {
            "query": query,
            "from": "0",
            "size": str(count),
            "sort": [{"filedAt": {"order": "desc"}}],
        }

        try:
            data = self._sec_query(payload, db=db, user_id=user_id, tier=tier)
        except Exception:
            # Fail soft and return mock data instead of breaking the pipeline
            return self.fetch_mock_filings(symbol, count=count)

        filings_meta = data.get("filings", []) or []
        results: List[Dict] = []

        for f in filings_meta[:count]:
            form_type = f.get("formType", "")
            filed_at = f.get("filedAt")
            period_of_report = f.get("periodOfReport")

            try:
                filing_dt = datetime.fromisoformat(filed_at.replace("Z", "+00:00")) if filed_at else datetime.utcnow()
            except Exception:
                filing_dt = datetime.utcnow()

            try:
                period_dt = (
                    datetime.fromisoformat(period_of_report)
                    if period_of_report
                    else None
                )
            except Exception:
                period_dt = None

            url = (
                f.get("linkToHtml")
                or f.get("linkToFilingDetails")
                or f.get("linkToText")
                or ""
            )
            content = self._download_filing_content(url)

            summary = f"{form_type} filed at {filed_at} for {symbol.upper()}"

            results.append(
                {
                    "form_type": form_type,
                    "filing_date": filing_dt,
                    "period_end_date": period_dt,
                    "accession_number": f.get("accessionNo", ""),
                    "url": url,
                    "content": content,
                    "summary": summary,
                }
            )

        if not results:
            # Ensure we always return something so RAG has context
            return self.fetch_mock_filings(symbol, count=count)

        return results
    
    def fetch_mock_filings(self, symbol: str, count: int = 5) -> List[Dict]:
        """Generate mock filings for testing"""
        filing_types = ["10-K", "10-Q", "8-K"]
        periods = [
            datetime.now() - timedelta(days=90),
            datetime.now() - timedelta(days=180),
            datetime.now() - timedelta(days=270),
            datetime.now() - timedelta(days=365),
            datetime.now() - timedelta(days=455)
        ]
        
        filings = []
        for i in range(count):
            filing_type = filing_types[i % len(filing_types)]
            filings.append({
                "form_type": filing_type,
                "filing_date": periods[i],
                "period_end_date": periods[i] - timedelta(days=30) if filing_type != "8-K" else None,
                "accession_number": f"{symbol}-{i+1:06d}",
                "url": f"https://www.sec.gov/Archives/edgar/data/{symbol.lower()}/{filing_type.lower()}-{i+1}.txt",
                "content": self._generate_mock_filing_content(symbol, filing_type),
                "summary": f"Mock {filing_type} filing for {symbol} covering period ending {periods[i].strftime('%Y-%m-%d')}"
            })
        
        return filings
    
    def _generate_mock_filing_content(self, symbol: str, form_type: str) -> str:
        """Generate mock filing content"""
        sections = {
            "10-K": [
                "RISK FACTORS",
                "MANAGEMENT'S DISCUSSION AND ANALYSIS",
                "FINANCIAL STATEMENTS",
                "MARKET FOR REGISTRANT'S COMMON EQUITY"
            ],
            "10-Q": [
                "FINANCIAL STATEMENTS",
                "MANAGEMENT'S DISCUSSION AND ANALYSIS",
                "QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK"
            ],
            "8-K": [
                "CURRENT REPORT",
                "ITEM INFORMATION"
            ]
        }
        
        content = f"FORM {form_type} - {symbol}\n\n"
        for section in sections.get(form_type, ["GENERAL INFORMATION"]):
            content += f"\n{section}\n"
            content += f"This section contains information about {symbol} related to {section.lower()}.\n"
            content += "The company has disclosed various risk factors and financial information.\n"
            content += "Management discusses the company's performance and outlook.\n\n"
        
        return content
    
    def chunk_filing_content(
        self,
        content: str,
        chunk_size: int = 1000,
        overlap: int = 200
    ) -> List[Dict]:
        """Split filing content into chunks for embedding"""
        # Simple chunking by character count with overlap
        chunks = []
        start = 0
        chunk_index = 0
        
        # Try to split by sections first
        sections = re.split(r'\n([A-Z][A-Z\s&]+)\n', content)
        
        current_section = "General"
        for i, part in enumerate(sections):
            if i % 2 == 1:  # Section header
                current_section = part.strip()
                continue
            
            # Split large sections into smaller chunks
            text = part.strip()
            if len(text) <= chunk_size:
                if text:
                    chunks.append({
                        "chunk_index": chunk_index,
                        "content": text,
                        "section": current_section
                    })
                    chunk_index += 1
            else:
                # Split into smaller chunks
                for j in range(0, len(text), chunk_size - overlap):
                    chunk_text = text[j:j + chunk_size]
                    if chunk_text.strip():
                        chunks.append({
                            "chunk_index": chunk_index,
                            "content": chunk_text.strip(),
                            "section": current_section
                        })
                        chunk_index += 1
        
        return chunks
    
    def save_filing_to_db(
        self,
        db: Session,
        symbol: Symbol,
        filing_data: Dict,
        chunk_content: bool = True
    ) -> Filing:
        """Save filing and chunks to database"""
        # Check if filing exists
        existing = db.query(Filing).filter(
            Filing.accession_number == filing_data["accession_number"]
        ).first()
        
        if existing:
            return existing
        
        filing = Filing(
            symbol_id=symbol.id,
            form_type=filing_data["form_type"],
            filing_date=filing_data["filing_date"],
            period_end_date=filing_data.get("period_end_date"),
            accession_number=filing_data["accession_number"],
            url=filing_data["url"],
            content=filing_data["content"],
            summary=filing_data.get("summary", "")
        )
        db.add(filing)
        db.flush()  # Get the ID
        
        # Create chunks if requested
        if chunk_content and filing_data.get("content"):
            chunks = self.chunk_filing_content(filing_data["content"])
            for chunk_data in chunks:
                chunk = FilingChunk(
                    filing_id=filing.id,
                    chunk_index=chunk_data["chunk_index"],
                    content=chunk_data["content"],
                    section=chunk_data["section"]
                )
                db.add(chunk)
        
        db.commit()
        db.refresh(filing)
        return filing
    
    def sync_filings_for_symbol(
        self,
        db: Session,
        symbol: str,
        use_mock: bool = True,
        user_id: int | None = None,
        tier: str | None = None,
    ) -> int:
        """Sync filings for a symbol"""
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if not db_symbol:
            return 0
        
        if use_mock:
            filings = self.fetch_mock_filings(symbol)
        else:
            filings = self.fetch_secapi_filings(symbol, db=db, user_id=user_id, tier=tier)
        
        count = 0
        for filing_data in filings:
            self.save_filing_to_db(db, db_symbol, filing_data, chunk_content=True)
            count += 1
        
        return count
