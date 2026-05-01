"""SEC filing 3-pass chunker. Full implementation in Task 4."""
from __future__ import annotations
import hashlib
from dataclasses import dataclass, field


@dataclass
class Chunk:
    chunk_id:        str
    parent_chunk_id: str
    text:            str
    token_count:     int
    section:         str
    item_number:     str
    is_parent:       bool
    ticker:          str
    company_name:    str
    filing_type:     str
    filed_date:      str
    fiscal_year:     int
    cik:             str
    content_hash:    str = field(init=False)

    def __post_init__(self) -> None:
        self.content_hash = hashlib.sha256(self.text.encode()).hexdigest()
