"""Model evaluator — reads train_summary.json, produces model_card.json.

Thresholds (hard floor — below these the model should NOT go to production):
  DA  >= 0.50   (must beat coin flip)
  IC  >= -0.10  (tolerate mildly negative IC; promote lambda has tighter gate)
  Sharpe >= -0.5 (extremely loss-making strategies blocked)

Run standalone:
    python -m ml.model_evaluator [--summary ml/train_summary.json]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("ml.model_evaluator")

SUMMARY_PATH = Path("ml/train_summary.json")
CARD_PATH = Path("ml/model_card.json")

# Hard floors — below any of these the CI eval step fails
DA_FLOOR = 0.50
IC_FLOOR = -0.10
SHARPE_FLOOR = -0.5


@dataclass
class HorizonEval:
    horizon: int
    da: float
    ic: float
    sharpe: float
    da_ok: bool
    ic_ok: bool
    sharpe_ok: bool
    grade: str      # A B C D F

    @property
    def pass_floor(self) -> bool:
        return self.da_ok and self.ic_ok and self.sharpe_ok


def _grade(da: float, ic: float) -> str:
    if da >= 0.56 and ic >= 0.05:
        return "A"
    if da >= 0.53 and ic >= 0.00:
        return "B"
    if da >= 0.51 and ic >= -0.05:
        return "C"
    if da >= 0.50:
        return "D"
    return "F"


def evaluate(summary_path: Path = SUMMARY_PATH) -> tuple[dict[str, Any], bool]:
    """
    Read train_summary.json, evaluate each horizon, return (card, passed).
    `passed` is False if any horizon fails the hard floor.
    """
    if not summary_path.exists():
        logger.error("train_summary.json not found at %s", summary_path)
        return {}, False

    with open(summary_path) as f:
        summary = json.load(f)

    run_id = summary.get("run_id", "unknown")
    shard = summary.get("shard_name", "unknown")
    tier = summary.get("symbol_tier", "unknown")
    results = summary.get("results", [])

    horizon_evals: list[HorizonEval] = []
    for r in results:
        if r.get("status") != "completed":
            continue
        m = r.get("test_metrics", {})
        da = float(m.get("directional_accuracy") or 0.0)
        ic = float(m.get("information_coefficient") or 0.0)
        sharpe = float(m.get("hypothetical_sharpe") or 0.0)
        h = int(r["horizon"])
        horizon_evals.append(HorizonEval(
            horizon=h,
            da=round(da, 4),
            ic=round(ic, 4),
            sharpe=round(sharpe, 4),
            da_ok=da >= DA_FLOOR,
            ic_ok=ic >= IC_FLOOR,
            sharpe_ok=sharpe >= SHARPE_FLOOR,
            grade=_grade(da, ic),
        ))

    passed = all(e.pass_floor for e in horizon_evals) and len(horizon_evals) > 0
    overall_grade = min((e.grade for e in horizon_evals), key=lambda g: "ABCDF".index(g)) if horizon_evals else "F"

    card: dict[str, Any] = {
        "run_id": run_id,
        "shard": shard,
        "tier": tier,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "overall_grade": overall_grade,
        "floor_passed": passed,
        "horizons": [asdict(e) for e in horizon_evals],
        "thresholds": {
            "da_floor": DA_FLOOR,
            "ic_floor": IC_FLOOR,
            "sharpe_floor": SHARPE_FLOOR,
        },
        "failures": [
            {
                "horizon": e.horizon,
                "da": e.da,
                "ic": e.ic,
                "sharpe": e.sharpe,
                "reason": (
                    (f"DA {e.da:.3f} < floor {DA_FLOOR}" if not e.da_ok else "") + " " +
                    (f"IC {e.ic:.3f} < floor {IC_FLOOR}" if not e.ic_ok else "") + " " +
                    (f"Sharpe {e.sharpe:.3f} < floor {SHARPE_FLOOR}" if not e.sharpe_ok else "")
                ).strip()
            }
            for e in horizon_evals if not e.pass_floor
        ],
    }

    return card, passed


def _print_card(card: dict) -> None:
    evals = card.get("horizons", [])
    print("")
    print("╔══════════════════════════════════════════════════╗")
    print("║           MODEL EVALUATION CARD                 ║")
    print("╠══════════════════════════════════════════════════╣")
    print(f"║  Run:    {card.get('run_id', 'n/a')[:36]:<40}  ║")
    print(f"║  Shard:  {card.get('shard', 'n/a'):<40}  ║")
    print(f"║  Grade:  {card.get('overall_grade', '?'):<40}  ║")
    print(f"║  Floor:  {'PASSED ✓' if card.get('floor_passed') else 'FAILED ✗':<40}  ║")
    print("╠══════════════════════════════════════════════════╣")
    print(f"║  {'Horizon':<8}  {'DA':<8}  {'IC':<8}  {'Sharpe':<8}  {'Grade':<5}  ║")
    print("╠══════════════════════════════════════════════════╣")
    for e in evals:
        da_flag = "✓" if e["da_ok"] else "✗"
        ic_flag = "✓" if e["ic_ok"] else "✗"
        sh_flag = "✓" if e["sharpe_ok"] else "✗"
        print(
            f"║  h={e['horizon']:<6}  "
            f"{e['da']:.4f}{da_flag}  "
            f"{e['ic']:+.4f}{ic_flag}  "
            f"{e['sharpe']:+.4f}{sh_flag}  "
            f"{e['grade']:<5}  ║"
        )
    if card.get("failures"):
        print("╠══════════════════════════════════════════════════╣")
        print("║  FAILURES:                                       ║")
        for f in card["failures"]:
            reason = f.get("reason", "")[:44]
            print(f"║  h={f['horizon']}: {reason:<44}  ║")
    print("╚══════════════════════════════════════════════════╝")
    print("")


def run(summary_path: Path = SUMMARY_PATH, card_path: Path = CARD_PATH) -> int:
    """Returns 0 if floors passed, 1 if any horizon failed."""
    card, passed = evaluate(summary_path)
    if not card:
        logger.error("No model card produced — train_summary.json missing or empty")
        return 1

    card_path.parent.mkdir(parents=True, exist_ok=True)
    with open(card_path, "w") as f:
        json.dump(card, f, indent=2, default=str)
    logger.info("Model card written to %s", card_path)

    _print_card(card)

    if not passed:
        logger.error(
            "EVAL GATE FAILED: %d horizon(s) below hard floor. "
            "Model will NOT be promoted to production.",
            len(card.get("failures", [])),
        )
        return 1

    logger.info("EVAL GATE PASSED: grade=%s", card.get("overall_grade"))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", default=str(SUMMARY_PATH))
    parser.add_argument("--card", default=str(CARD_PATH))
    args = parser.parse_args()
    sys.exit(run(Path(args.summary), Path(args.card)))
