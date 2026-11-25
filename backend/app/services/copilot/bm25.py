"""Pure-Python BM25 sparse encoder for Qdrant (no fastembed / ONNX / torch).

Documents are encoded with the BM25 term-frequency saturation; the collection's
sparse vector uses ``Modifier.IDF`` so Qdrant applies inverse document
frequency at query time.  Queries are encoded as unit weights per unique term.
Token ids are a stable 31-bit hash, identical in the API and the worker.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from typing import List, Tuple

K1 = 1.2
B = 0.75
AVG_DOC_LEN = 300.0

_STOP = frozenset("""a an and are as at be been but by can could did do does for from had has have he
her his how i if in into is it its may might more most no not of on or our she should so such than that
the their them then there these they this those to under up was we were what when where which while who
will with would you your also any each other over per""".split())
_TOKEN = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")


def _stem(t: str) -> str:
    for suf in ("ings", "ing", "edly", "ies", "es", "ed", "ly", "s"):
        if len(t) > len(suf) + 3 and t.endswith(suf):
            return t[: -len(suf)] + ("y" if suf == "ies" else "")
    return t


def tokenize(text: str) -> List[str]:
    return [_stem(t) for t in _TOKEN.findall((text or "").lower()) if t not in _STOP and len(t) > 1]


def token_id(tok: str) -> int:
    return int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=4).digest(), "big") & 0x7FFFFFFF


def encode_document(text: str) -> Tuple[List[int], List[float]]:
    toks = tokenize(text)
    if not toks:
        return [], []
    tf = Counter(toks)
    norm = K1 * (1 - B + B * len(toks) / AVG_DOC_LEN)
    weights: dict[int, float] = {}
    for tok, n in tf.items():
        tid = token_id(tok)
        weights[tid] = weights.get(tid, 0.0) + n * (K1 + 1) / (n + norm)
    idx = sorted(weights)
    return idx, [round(weights[i], 5) for i in idx]


def encode_query(text: str) -> Tuple[List[int], List[float]]:
    ids = sorted({token_id(t) for t in tokenize(text)})
    return ids, [1.0] * len(ids)
