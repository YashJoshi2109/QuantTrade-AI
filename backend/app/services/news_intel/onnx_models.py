"""
ONNX Runtime inference for the news models (no torch / transformers import).

Model files are produced at image build time by app/services/news_intel/export_models.py:
  $NEWS_MODELS_DIR/finbert/{model.onnx, tokenizer.json, labels.json}
  $NEWS_MODELS_DIR/minilm/{model.onnx, tokenizer.json}

NEWS_MODELS_DIR defaults to /opt/news-models (baked into the Docker image).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

DEFAULT_DIR = "/opt/news-models"


def models_dir() -> Path:
    return Path(os.environ.get("NEWS_MODELS_DIR", DEFAULT_DIR))


def _threads() -> int:
    try:
        return max(1, int(os.environ.get("NEWS_INTEL_THREADS", os.environ.get("NEWS_INTEL_TORCH_THREADS", "1"))))
    except ValueError:
        return 1


class OnnxEncoder:
    """tokenizer.json + model.onnx -> raw model output for a batch of texts."""

    def __init__(self, model_dir: Path, max_length: int):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        model_path = model_dir / "model.onnx"
        tok_path = model_dir / "tokenizer.json"
        if not model_path.exists() or not tok_path.exists():
            raise FileNotFoundError(f"ONNX model files missing in {model_dir}")
        tok = Tokenizer.from_file(str(tok_path))
        tok.enable_truncation(max_length=max_length)
        pad_id = tok.token_to_id("[PAD]")
        tok.enable_padding(pad_id=0 if pad_id is None else pad_id, pad_token="[PAD]")
        self.tokenizer = tok

        so = ort.SessionOptions()
        so.intra_op_num_threads = _threads()
        so.inter_op_num_threads = 1
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # The arena keeps peak activations allocated forever; batches are small,
        # so trade a little speed for a flat RSS.
        so.enable_cpu_mem_arena = False
        self.session = ort.InferenceSession(str(model_path), sess_options=so, providers=["CPUExecutionProvider"])
        self.input_names = {i.name for i in self.session.get_inputs()}

    def encode(self, texts: Sequence[str]):
        encs = self.tokenizer.encode_batch(list(texts))
        ids = np.asarray([e.ids for e in encs], dtype=np.int64)
        mask = np.asarray([e.attention_mask for e in encs], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.input_names:
            feeds["token_type_ids"] = np.asarray([e.type_ids for e in encs], dtype=np.int64)
        return self.session.run(None, feeds)[0], mask


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


class FinbertOnnx:
    def __init__(self, model_dir: Optional[Path] = None, max_length: int = 96):
        d = model_dir or (models_dir() / "finbert")
        self.enc = OnnxEncoder(d, max_length)
        labels = json.loads((d / "labels.json").read_text())
        self.id2label: Dict[int, str] = {int(k): v.lower() for k, v in labels.items()}

    def probs(self, texts: Sequence[str]) -> List[List[float]]:
        logits, _ = self.enc.encode(texts)
        return softmax(logits.astype(np.float32)).tolist()


class MiniLMOnnx:
    def __init__(self, model_dir: Optional[Path] = None, max_length: int = 128):
        self.enc = OnnxEncoder(model_dir or (models_dir() / "minilm"), max_length)

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        """Mean-pooled, L2-normalised sentence embeddings (sentence-transformers parity)."""
        hidden, mask = self.enc.encode(texts)
        m = mask[..., None].astype(np.float32)
        pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
        return pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)
