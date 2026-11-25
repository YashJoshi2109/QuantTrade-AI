#!/usr/bin/env python
"""
Export the news-intelligence models to int8 ONNX (build time only).

  python app/services/news_intel/export_models.py --out /opt/news-models

Writes:
  <out>/finbert/model.onnx       ProsusAI/finbert, logits, int8 dynamic quantization
  <out>/finbert/tokenizer.json   fast tokenizer (loaded with `tokenizers`, no transformers)
  <out>/finbert/labels.json      id -> label
  <out>/minilm/model.onnx        sentence-transformers/all-MiniLM-L6-v2, last_hidden_state, int8
  <out>/minilm/tokenizer.json

Needs torch + transformers + onnx + onnxruntime at export time only. The runtime
path (news_intel.onnx_models) needs onnxruntime + tokenizers + numpy.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

FINBERT = "ProsusAI/finbert"
MINILM = "sentence-transformers/all-MiniLM-L6-v2"


def _export(model, tok, path: Path, output_name: str) -> None:
    import torch

    enc = tok(["Apple beats estimates", "Fed holds rates steady as inflation cools"],
              padding=True, return_tensors="pt")
    names = ["input_ids", "attention_mask", "token_type_ids"]
    inputs = tuple(enc[n] for n in names)
    axes = {n: {0: "batch", 1: "seq"} for n in names}
    axes[output_name] = {0: "batch", 1: "seq"} if output_name == "last_hidden_state" else {0: "batch"}

    class Wrap(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask, token_type_ids):
            out = self.m(input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids)
            return out.logits if output_name == "logits" else out.last_hidden_state

    kwargs = dict(input_names=names, output_names=[output_name], dynamic_axes=axes, opset_version=17,
                  do_constant_folding=True)
    try:
        torch.onnx.export(Wrap(model).eval(), inputs, str(path), dynamo=False, **kwargs)
    except TypeError:  # older torch without the `dynamo` kwarg
        torch.onnx.export(Wrap(model).eval(), inputs, str(path), **kwargs)


def _quantize(src: Path, dst: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8)


def export_all(out: Path, keep_fp32: bool = False) -> None:
    import torch
    from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer

    torch.set_num_threads(max(1, os.cpu_count() or 1))
    tmp = Path(tempfile.mkdtemp(prefix="news-onnx-"))
    try:
        for name, repo, head, out_name in (
            ("finbert", FINBERT, AutoModelForSequenceClassification, "logits"),
            ("minilm", MINILM, AutoModel, "last_hidden_state"),
        ):
            d = out / name
            d.mkdir(parents=True, exist_ok=True)
            tok = AutoTokenizer.from_pretrained(repo, use_fast=True)
            model = head.from_pretrained(repo).eval()
            fp32 = tmp / f"{name}.fp32.onnx"
            with torch.inference_mode():
                _export(model, tok, fp32, out_name)
            _quantize(fp32, d / "model.onnx")
            if keep_fp32:
                shutil.copy(fp32, d / "model.fp32.onnx")
            tok.backend_tokenizer.save(str(d / "tokenizer.json"))
            if name == "finbert":
                (d / "labels.json").write_text(json.dumps({str(k): v for k, v in model.config.id2label.items()}))
            print(f"{name}: {(d / 'model.onnx').stat().st_size / 1e6:.1f} MB int8")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.environ.get("NEWS_MODELS_DIR", "/opt/news-models"))
    ap.add_argument("--keep-fp32", action="store_true")
    a = ap.parse_args()
    export_all(Path(a.out), a.keep_fp32)
