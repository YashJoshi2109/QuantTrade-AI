"""
3-pass document chunker for SEC filings.

Pass 1: Section detection — identify SEC item boundaries
Pass 2: Semantic chunking — split within sections using sentence similarity
Pass 3: Parent-child pairs — create child (search) + parent (context) chunks
"""
from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from sentence_transformers import SentenceTransformer

MAX_CHUNK_TOKENS     = 1024
TARGET_CHUNK_TOKENS  = 600
SIMILARITY_THRESHOLD = 0.75
SEMANTIC_MODEL_NAME  = "all-MiniLM-L6-v2"

SEC_SECTION_PATTERNS: dict[str, tuple[re.Pattern, str]] = {
    "Business":              (re.compile(r"item\s+1[.\s](?!a)", re.IGNORECASE), "1"),
    "Risk Factors":          (re.compile(r"item\s+1a[.\s]",     re.IGNORECASE), "1A"),
    "MD&A":                  (re.compile(r"item\s+7[.\s](?!a)", re.IGNORECASE), "7"),
    "Quantitative Market Risk": (re.compile(r"item\s+7a[.\s]", re.IGNORECASE), "7A"),
    "Financial Statements":  (re.compile(r"item\s+8[.\s]",      re.IGNORECASE), "8"),
    "Controls & Procedures": (re.compile(r"item\s+9a[.\s]",     re.IGNORECASE), "9A"),
}

# Sentence-splitting: split on ". " or "! " or "? " followed by uppercase,
# but not after common abbreviations.  We use a two-step approach because
# Python's `re` module requires fixed-width lookbehinds (tightened in 3.14).
_ABBREV_PATTERN = re.compile(
    r'\b(?:Inc|Corp|Ltd|Co|Mr|Mrs|Dr|vs|etc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.'
    r'\s',
    re.IGNORECASE,
)
_SENT_BOUNDARY = re.compile(r'(?<=[.!?])\s+(?=[A-Z])')

_semantic_model: Optional[SentenceTransformer] = None


def _get_model() -> SentenceTransformer:
    global _semantic_model
    if _semantic_model is None:
        _semantic_model = SentenceTransformer(SEMANTIC_MODEL_NAME)
    return _semantic_model


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


def detect_section(text: str) -> tuple[str, str]:
    for section, (pattern, item_num) in SEC_SECTION_PATTERNS.items():
        if pattern.search(text[:500]):
            return section, item_num
    return "Unknown", ""


def split_document_into_sections(full_text: str) -> list[tuple[str, str, str]]:
    sections: list[tuple[str, str, str]] = []
    boundaries: list[tuple[int, str, str]] = []
    for section, (pattern, item_num) in SEC_SECTION_PATTERNS.items():
        for match in pattern.finditer(full_text):
            boundaries.append((match.start(), section, item_num))
    boundaries.sort(key=lambda x: x[0])

    for i, (start, section, item_num) in enumerate(boundaries):
        end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(full_text)
        text = full_text[start:end].strip()
        if len(text) > 50:
            sections.append((section, item_num, text))

    if not sections:
        sections = [("Unknown", "", full_text)]
    return sections


def split_into_sentences(text: str) -> list[str]:
    """Split text into sentences, skipping common abbreviation boundaries."""
    # Protect abbreviation periods by replacing with a placeholder
    protected = _ABBREV_PATTERN.sub(lambda m: m.group(0).replace('. ', '@@DOT@@'), text.strip())
    raw = _SENT_BOUNDARY.split(protected)
    # Restore placeholders and strip
    return [s.replace('@@DOT@@', '. ').strip() for s in raw if s.strip()]


def _count_tokens(text: str) -> int:
    return int(len(text.split()) * 1.3)


def _hard_split_sentence(sentence: str, section: str, item: str) -> list[Chunk]:
    """Split an oversized single sentence (no boundaries) into word-level chunks."""
    words = sentence.split()
    # Each chunk may hold at most floor(MAX_CHUNK_TOKENS / 1.3) words
    max_words = int(MAX_CHUNK_TOKENS / 1.3)
    result: list[Chunk] = []
    for start in range(0, len(words), max_words):
        chunk_words = words[start : start + max_words]
        chunk_text = " ".join(chunk_words)
        result.append(_make_child_chunk(chunk_text, section, item))
    return result


def semantic_chunk(section_text: str, section: str, item: str) -> list[Chunk]:
    sentences = split_into_sentences(section_text)
    if not sentences:
        return []

    model = _get_model()
    embeddings = model.encode(sentences, convert_to_numpy=True)

    chunks: list[Chunk] = []
    current_sentences: list[str] = []
    current_tokens: int = 0

    def flush() -> None:
        nonlocal current_sentences, current_tokens
        if current_sentences:
            chunk_text = " ".join(current_sentences)
            chunks.append(_make_child_chunk(chunk_text, section, item))
            current_sentences = []
            current_tokens = 0

    for i, sent in enumerate(sentences):
        sent_tokens = _count_tokens(sent)

        # If this single sentence already exceeds the limit, hard-split it.
        if sent_tokens > MAX_CHUNK_TOKENS:
            flush()
            chunks.extend(_hard_split_sentence(sent, section, item))
            continue

        # Compute semantic similarity with previous sentence (when we have one)
        if i > 0:
            norm_prev = np.linalg.norm(embeddings[i - 1])
            norm_curr = np.linalg.norm(embeddings[i])
            if norm_prev > 0 and norm_curr > 0:
                sim = float(
                    np.dot(embeddings[i - 1], embeddings[i]) / (norm_prev * norm_curr)
                )
            else:
                sim = 1.0
        else:
            sim = 1.0

        would_exceed = (current_tokens + sent_tokens) > MAX_CHUNK_TOKENS
        semantic_break = sim < SIMILARITY_THRESHOLD

        if (semantic_break or would_exceed) and current_sentences:
            flush()

        current_sentences.append(sent)
        current_tokens += sent_tokens

    flush()
    return chunks


def _make_child_chunk(text: str, section: str, item: str) -> Chunk:
    return Chunk(
        chunk_id=str(uuid.uuid4()),
        parent_chunk_id="",
        text=text,
        token_count=_count_tokens(text),
        section=section,
        item_number=item,
        is_parent=False,
        ticker="",
        company_name="",
        filing_type="",
        filed_date="",
        fiscal_year=0,
        cik="",
    )


def build_parent_child_pairs(
    child_chunks: list[Chunk],
    full_section_text: str,
    filing_meta: dict,
) -> tuple[list[Chunk], Chunk]:
    parent_id   = str(uuid.uuid4())
    ticker      = filing_meta["ticker"]
    company     = filing_meta["company_name"]
    filing_type = filing_meta["filing_type"]
    filed_date  = filing_meta["filed_date"]
    fiscal_year = filing_meta["fiscal_year"]
    cik         = filing_meta["cik"]

    parent_text = full_section_text
    if _count_tokens(parent_text) > 4096:
        words = parent_text.split()
        parent_text = " ".join(words[:3100])

    section  = child_chunks[0].section    if child_chunks else "Unknown"
    item_num = child_chunks[0].item_number if child_chunks else ""

    parent = Chunk(
        chunk_id=parent_id,
        parent_chunk_id=parent_id,
        text=parent_text,
        token_count=_count_tokens(parent_text),
        section=section,
        item_number=item_num,
        is_parent=True,
        ticker=ticker,
        company_name=company,
        filing_type=filing_type,
        filed_date=filed_date,
        fiscal_year=fiscal_year,
        cik=cik,
    )

    children_with_meta = [
        Chunk(
            chunk_id=c.chunk_id,
            parent_chunk_id=parent_id,
            text=c.text,
            token_count=c.token_count,
            section=c.section,
            item_number=c.item_number,
            is_parent=False,
            ticker=ticker,
            company_name=company,
            filing_type=filing_type,
            filed_date=filed_date,
            fiscal_year=fiscal_year,
            cik=cik,
        )
        for c in child_chunks
    ]

    return children_with_meta, parent


def chunk_filing(full_text: str, filing_meta: dict) -> tuple[list[Chunk], list[Chunk]]:
    sections = split_document_into_sections(full_text)
    all_children: list[Chunk] = []
    all_parents:  list[Chunk] = []

    for section_name, item_num, section_text in sections:
        child_chunks = semantic_chunk(section_text, section_name, item_num)
        if not child_chunks:
            continue
        children, parent = build_parent_child_pairs(child_chunks, section_text, filing_meta)
        all_children.extend(children)
        all_parents.append(parent)

    return all_children, all_parents
