"""The 768M API container must not load torch / sentence-transformers.

v1 imported sentence_transformers at module import (embedding_service via
api/chat.py) and torch via api/predictions.py, costing ~400MB RSS per worker.
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]


def test_importing_app_main_does_not_import_torch():
    code = ("import sys, app.main; heavy = [m for m in ('torch', 'sentence_transformers', 'transformers', "
            "'onnxruntime', 'fastembed') if m in sys.modules]; print('HEAVY=' + ','.join(heavy))")
    env = {**os.environ, "APP_ENV": "development", "RUN_BACKGROUND_JOBS": "0", "PYTHONPATH": str(BACKEND)}
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True,
                         text=True, timeout=180)
    line = next((l for l in out.stdout.splitlines() if l.startswith("HEAVY=")), None)
    assert line is not None, out.stderr[-2000:]
    assert line == "HEAVY=", f"API process imported heavy ML modules: {line}"
