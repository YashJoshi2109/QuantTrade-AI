#!/usr/bin/env python
"""Measure process RSS (Linux /proc) for the news-intel models.

  python scripts/measure_news_intel_rss.py [--quantize auto|0|1]

Prints RSS after torch/transformers imports, after FinBERT load + a batch of
16 inferences, and after the MiniLM categorizer load + inference.
"""
import argparse
import gc
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def rss():
    try:
        with open("/proc/self/status") as f:
            d = dict(l.split(":", 1) for l in f if l.startswith(("VmRSS", "RssAnon", "RssFile")))
        return {k: int(v.split()[0]) // 1024 for k, v in d.items()}
    except FileNotFoundError:
        import subprocess
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True)
        return {"VmRSS": int(out.stdout.strip()) // 1024}


ap = argparse.ArgumentParser()
ap.add_argument("--quantize", default="0")
args = ap.parse_args()
os.environ["NEWS_INTEL_QUANTIZE"] = args.quantize

import torch  # noqa: E402,F401
import transformers  # noqa: E402,F401
import sentence_transformers  # noqa: E402,F401

print("after imports      ", rss())
from app.services.news_intel.sentiment import SentimentClassifier  # noqa: E402
from app.services.news_intel.categorizer import Categorizer  # noqa: E402

texts = ["Nvidia beats estimates as data center revenue soars"] * 16
clf = SentimentClassifier()
assert clf.load(), clf.load_error
clf.classify(texts)
gc.collect()
print(f"after FinBERT ({clf.backend})", rss())
cat = Categorizer()
assert cat.load(), cat.load_error
cat.classify(["Week ahead on Wall Street"] * 16)
gc.collect()
print("after MiniLM       ", rss())
