#!/usr/bin/env python
"""
Evaluate the news-intelligence fast path.

  1. Sentiment: accuracy + macro-F1 on Financial PhraseBank (Sentences_AllAgree,
     HF dataset takala/financial_phrasebank). NOTE: ProsusAI/finbert was
     fine-tuned on Financial PhraseBank, so this is an optimistic, partly
     in-sample number — use it as a regression check, not a generalisation claim.
  2. Categories: multi-label precision/recall/F1 (micro + macro) and primary
     accuracy on tests/fixtures/news_categories.jsonl.
  3. Latency: per-item CPU latency p50/p95 at batch size 1 and 16 for the
     sentiment model, the categorizer, and both together.
  4. Memory: process RSS before/after loading both models.

Usage (from backend/):
  python scripts/eval_news_intel.py [--models-dir /opt/news-models] [--threads 1] [--json out.json]
No database or network needed except the one-time HF downloads.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def rss_mb() -> float:
    try:
        import psutil

        return psutil.Process().memory_info().rss / 1e6
    except ImportError:
        try:
            with open("/proc/self/status") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        return int(line.split()[1]) / 1e3
        except FileNotFoundError:
            pass
        import subprocess

        out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True)
        return int(out.stdout.strip() or 0) / 1e3  # KiB -> MB (current RSS)


def load_phrasebank():
    from huggingface_hub import hf_hub_download

    path = hf_hub_download("takala/financial_phrasebank", "data/FinancialPhraseBank-v1.0.zip", repo_type="dataset")
    with zipfile.ZipFile(path) as z:
        raw = z.read("FinancialPhraseBank-v1.0/Sentences_AllAgree.txt").decode("latin-1")
    rows = []
    for line in raw.splitlines():
        if "@" not in line:
            continue
        text, label = line.rsplit("@", 1)
        label = label.strip()
        rows.append((text.strip(), {"positive": "bullish", "negative": "bearish", "neutral": "neutral"}[label]))
    return rows


def macro_f1(y_true, y_pred, labels):
    f1s, per = [], {}
    for lab in labels:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == lab and p == lab)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != lab and p == lab)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == lab and p != lab)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per[lab] = {"precision": round(prec, 4), "recall": round(rec, 4), "f1": round(f1, 4), "support": tp + fn}
        f1s.append(f1)
    return sum(f1s) / len(f1s), per


def eval_sentiment(clf):
    rows = load_phrasebank()
    texts = [t for t, _ in rows]
    gold = [g for _, g in rows]
    t0 = time.perf_counter()
    preds = [s.label for s in clf.classify(texts, batch_size=16)]
    secs = time.perf_counter() - t0
    acc = sum(p == g for p, g in zip(preds, gold)) / len(gold)
    f1, per = macro_f1(gold, preds, ["bullish", "bearish", "neutral"])
    return {"dataset": "financial_phrasebank/Sentences_AllAgree", "n": len(gold),
            "accuracy": round(acc, 4), "macro_f1": round(f1, 4), "per_class": per,
            "backend": clf.backend, "throughput_items_per_s": round(len(gold) / secs, 1)}


def eval_categories(cat):
    from app.services.news_intel.categories import CATEGORY_KEYS

    path = ROOT / "tests" / "fixtures" / "news_categories.jsonl"
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    results = cat.classify([r["title"] for r in rows])
    tp, fp, fn = Counter(), Counter(), Counter()
    primary_ok = 0
    methods = Counter()
    errors = []
    for r, res in zip(rows, results):
        gold, pred = set(r["categories"]), set(res.categories)
        methods[res.method] += 1
        for c in pred & gold:
            tp[c] += 1
        for c in pred - gold:
            fp[c] += 1
        for c in gold - pred:
            fn[c] += 1
        if res.primary == r["primary"]:
            primary_ok += 1
        else:
            errors.append({"title": r["title"], "gold": r["primary"], "pred": res.primary, "method": res.method})
    per = {}
    ps, rs = [], []
    for c in CATEGORY_KEYS:
        p = tp[c] / (tp[c] + fp[c]) if tp[c] + fp[c] else 0.0
        rc = tp[c] / (tp[c] + fn[c]) if tp[c] + fn[c] else 0.0
        if tp[c] + fn[c]:
            ps.append(p)
            rs.append(rc)
        per[c] = {"precision": round(p, 3), "recall": round(rc, 3), "support": tp[c] + fn[c]}
    TP, FP, FN = sum(tp.values()), sum(fp.values()), sum(fn.values())
    micro_p, micro_r = TP / (TP + FP), TP / (TP + FN)
    return {
        "n": len(rows),
        "micro_precision": round(micro_p, 4), "micro_recall": round(micro_r, 4),
        "micro_f1": round(2 * micro_p * micro_r / (micro_p + micro_r), 4),
        "macro_precision": round(sum(ps) / len(ps), 4), "macro_recall": round(sum(rs) / len(rs), 4),
        "primary_accuracy": round(primary_ok / len(rows), 4),
        "methods": dict(methods), "per_category": per, "primary_errors": errors,
    }


def pct(vals, p):
    v = sorted(vals)
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def eval_latency(clf, cat, texts, reps=40):
    out = {}
    for bs in (1, 16):
        for name, fn in (
            ("sentiment", lambda b: clf.classify(b, batch_size=bs)),
            ("categorizer", lambda b: cat.classify(b)),
            ("both", lambda b: (clf.classify(b, batch_size=bs), cat.classify(b))),
        ):
            per_item = []
            for i in range(reps):
                batch = [texts[(i * bs + j) % len(texts)] for j in range(bs)]
                t0 = time.perf_counter()
                fn(batch)
                per_item.append((time.perf_counter() - t0) * 1000 / bs)
            out[f"{name}_bs{bs}"] = {"p50_ms_per_item": round(statistics.median(per_item), 2),
                                     "p95_ms_per_item": round(pct(per_item, 0.95), 2)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models-dir", default=os.environ.get("NEWS_MODELS_DIR", "/opt/news-models"),
                    help="output of app/services/news_intel/export_models.py")
    ap.add_argument("--threads", default=os.environ.get("NEWS_INTEL_THREADS", "1"))
    ap.add_argument("--skip-phrasebank", action="store_true")
    ap.add_argument("--json", help="write full results here")
    args = ap.parse_args()
    os.environ["NEWS_INTEL_MODELS"] = "1"
    os.environ["NEWS_MODELS_DIR"] = args.models_dir
    os.environ["NEWS_INTEL_THREADS"] = str(args.threads)

    import numpy  # noqa: F401  (import cost out of the RSS delta)
    import onnxruntime  # noqa: F401
    import tokenizers  # noqa: F401
    from app.services.news_intel.categorizer import Categorizer
    from app.services.news_intel.sentiment import SentimentClassifier

    rss0 = rss_mb()
    clf = SentimentClassifier()
    t0 = time.perf_counter()
    assert clf.load(), clf.load_error
    sent_load = time.perf_counter() - t0
    rss1 = rss_mb()
    cat = Categorizer()
    t0 = time.perf_counter()
    assert cat.load(), cat.load_error
    cat_load = time.perf_counter() - t0
    rss2 = rss_mb()

    import platform
    res = {"env": {"platform": platform.platform(), "machine": platform.machine(),
                   "threads": int(args.threads), "runtime": "onnxruntime " + onnxruntime.__version__,
                   "sentiment_backend": clf.backend},
           "load_seconds": {"finbert": round(sent_load, 2), "minilm_categorizer": round(cat_load, 2)},
           "memory_mb": {"after_imports": round(rss0), "after_finbert": round(rss1),
                         "after_minilm": round(rss2), "models_delta": round(rss2 - rss0)}}
    fixture = [json.loads(l)["title"] for l in (ROOT / "tests/fixtures/news_categories.jsonl").read_text().splitlines() if l.strip()]
    clf.classify(fixture[:16]); cat.classify(fixture[:16])  # warm-up
    res["memory_mb"]["after_warmup_inference"] = round(rss_mb())
    res["categories"] = eval_categories(cat)
    res["latency"] = eval_latency(clf, cat, fixture)
    if not args.skip_phrasebank:
        res["sentiment"] = eval_sentiment(clf)
    res["memory_mb"]["after_eval"] = round(rss_mb())

    summary = {k: v for k, v in res.items() if k != "categories"}
    summary["categories"] = {k: v for k, v in res["categories"].items() if k not in ("per_category", "primary_errors")}
    print(json.dumps(summary, indent=2))
    print("\nper-category:", json.dumps(res["categories"]["per_category"]))
    print("\nprimary errors:")
    for e in res["categories"]["primary_errors"]:
        print(f"  [{e['gold']} -> {e['pred']} via {e['method']}] {e['title']}")
    if args.json:
        Path(args.json).write_text(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
