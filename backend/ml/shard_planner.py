"""Manifest-driven shard planner for ML training pipeline.

Splits a symbol universe into balanced shards based on:
- max symbols per shard
- runtime hints (historical cost estimates)
- priority tiers

Produces ShardManifest objects that can be serialized to S3/JSON.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ml.constants import SYMBOL_TIERS, TIER_1_SYMBOLS, TIER_2_SYMBOLS, TIER_3_SYMBOLS


# ── Default runtime estimates (seconds per symbol per horizon) ────────

# Based on observed GH Actions runs: ~15-25s per symbol for download+features+train
# These are conservative CPU estimates; will be refined with actual runtime data.
DEFAULT_RUNTIME_HINTS: dict[str, float] = {
    # Tier 1 mega-caps: more data, slightly slower
    **{s: 25.0 for s in TIER_1_SYMBOLS},
    # Tier 2 large-caps: normal
    **{s: 20.0 for s in TIER_2_SYMBOLS},
    # Tier 3 mid/small-caps: less data, slightly faster
    **{s: 18.0 for s in TIER_3_SYMBOLS},
}

# Fallback for unknown symbols
DEFAULT_SYMBOL_RUNTIME = 20.0


@dataclass
class ShardManifest:
    """Describes a single training shard — input to a Batch job or GH Actions job."""
    shard_id: str
    shard_index: int
    shard_name: str
    run_id: str
    symbols: list[str]
    horizons: list[int]
    config_hash: str = ""
    estimated_runtime_seconds: int = 0
    feature_version: str = "v1"
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()

    @property
    def symbol_count(self) -> int:
        return len(self.symbols)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, data: str | dict) -> ShardManifest:
        if isinstance(data, str):
            data = json.loads(data)
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

    def save(self, path: Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json())
        return path


@dataclass
class ShardPlan:
    """Complete shard plan for a training run."""
    run_id: str
    run_type: str  # weekday | sunday | backfill | manual
    shards: list[ShardManifest]
    total_symbols: int = 0
    total_estimated_runtime_seconds: int = 0
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()
        self.total_symbols = sum(s.symbol_count for s in self.shards)
        if self.shards:
            # Wall-clock = max shard runtime (parallel execution)
            self.total_estimated_runtime_seconds = max(s.estimated_runtime_seconds for s in self.shards)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "run_type": self.run_type,
            "total_symbols": self.total_symbols,
            "total_shards": len(self.shards),
            "total_estimated_runtime_seconds": self.total_estimated_runtime_seconds,
            "created_at": self.created_at,
            "shards": [s.to_dict() for s in self.shards],
        }

    def summary(self) -> str:
        lines = [
            f"Shard Plan: {self.run_type} run ({self.run_id[:8]})",
            f"  Total symbols: {self.total_symbols}",
            f"  Shards: {len(self.shards)}",
            f"  Est. wall-clock: {self.total_estimated_runtime_seconds // 60}m",
            "",
        ]
        for s in self.shards:
            lines.append(
                f"  [{s.shard_index}] {s.shard_name}: "
                f"{s.symbol_count} symbols, "
                f"~{s.estimated_runtime_seconds // 60}m"
            )
        return "\n".join(lines)


def _estimate_runtime(symbols: list[str], horizons: list[int], runtime_hints: dict[str, float]) -> int:
    """Estimate total runtime in seconds for a set of symbols across horizons.

    Model: feature_compute_time (once) + per_horizon_train_time * n_horizons
    Feature compute ~60% of per-symbol cost, training ~40% per horizon.
    """
    total = 0.0
    for sym in symbols:
        per_sym = runtime_hints.get(sym, DEFAULT_SYMBOL_RUNTIME)
        # Feature computation: 60% of cost, done once
        feature_cost = per_sym * 0.6
        # Training per horizon: 40% of cost, done per horizon
        train_cost = per_sym * 0.4 * len(horizons)
        total += feature_cost + train_cost
    return int(total)


def plan_shards(
    symbols: list[str],
    horizons: list[int] | None = None,
    run_id: str | None = None,
    run_type: str = "manual",
    max_symbols_per_shard: int = 200,
    max_runtime_seconds: int = 7200,  # 2 hours target
    runtime_hints: dict[str, float] | None = None,
    config_hash: str = "",
) -> ShardPlan:
    """Plan balanced training shards from a symbol universe.

    Balances shards by estimated runtime, not just symbol count.
    Falls back to equal-count splitting when no runtime hints available.

    Args:
        symbols: Full list of symbols to train.
        horizons: Prediction horizons (default [1, 7, 30]).
        run_id: Unique run identifier (generated if not provided).
        run_type: weekday | sunday | backfill | manual.
        max_symbols_per_shard: Hard cap on symbols per shard.
        max_runtime_seconds: Target max runtime per shard.
        runtime_hints: {symbol: seconds} historical runtime estimates.
        config_hash: Hash of training config for lineage.

    Returns:
        ShardPlan with balanced ShardManifest objects.
    """
    if not symbols:
        raise ValueError("No symbols provided for shard planning")

    horizons = horizons or [7]
    run_id = run_id or str(uuid.uuid4())
    hints = runtime_hints or DEFAULT_RUNTIME_HINTS

    # Sort symbols by estimated cost (heaviest first) for better bin-packing
    sorted_symbols = sorted(symbols, key=lambda s: hints.get(s, DEFAULT_SYMBOL_RUNTIME), reverse=True)

    # Determine number of shards needed
    total_runtime = _estimate_runtime(sorted_symbols, horizons, hints)
    shards_by_runtime = max(1, (total_runtime + max_runtime_seconds - 1) // max_runtime_seconds)
    shards_by_count = max(1, (len(sorted_symbols) + max_symbols_per_shard - 1) // max_symbols_per_shard)
    n_shards = max(shards_by_runtime, shards_by_count)

    # Greedy bin-packing: assign each symbol to the shard with lowest accumulated runtime
    bins: list[list[str]] = [[] for _ in range(n_shards)]
    bin_costs: list[float] = [0.0] * n_shards

    for sym in sorted_symbols:
        # Find lightest bin
        min_idx = bin_costs.index(min(bin_costs))
        bins[min_idx].append(sym)
        sym_cost = hints.get(sym, DEFAULT_SYMBOL_RUNTIME)
        bin_costs[min_idx] += sym_cost * 0.6 + sym_cost * 0.4 * len(horizons)

    # Build manifests
    manifests: list[ShardManifest] = []
    for i, bin_symbols in enumerate(bins):
        if not bin_symbols:
            continue
        shard_id = str(uuid.uuid4())
        manifests.append(ShardManifest(
            shard_id=shard_id,
            shard_index=i,
            shard_name=f"shard_{i:02d}",
            run_id=run_id,
            symbols=sorted(bin_symbols),  # alphabetical for determinism
            horizons=horizons,
            config_hash=config_hash,
            estimated_runtime_seconds=_estimate_runtime(bin_symbols, horizons, hints),
        ))

    return ShardPlan(
        run_id=run_id,
        run_type=run_type,
        shards=manifests,
    )


def plan_shards_by_tier(
    tier: str,
    horizons: list[int] | None = None,
    run_id: str | None = None,
    run_type: str = "manual",
    **kwargs: Any,
) -> ShardPlan:
    """Convenience: plan shards for a named tier."""
    symbols = SYMBOL_TIERS.get(tier)
    if symbols is None:
        raise ValueError(f"Unknown tier: {tier}. Available: {list(SYMBOL_TIERS.keys())}")
    return plan_shards(symbols, horizons=horizons, run_id=run_id, run_type=run_type, **kwargs)


# ── CLI for dry-run inspection ────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="ML Shard Planner — dry-run inspection")
    parser.add_argument("--tier", type=str, default="all", help="Symbol tier")
    parser.add_argument("--symbols", nargs="+", default=None, help="Override symbols")
    parser.add_argument("--max-per-shard", type=int, default=200, help="Max symbols per shard")
    parser.add_argument("--max-runtime", type=int, default=7200, help="Max runtime per shard (seconds)")
    parser.add_argument("--run-type", type=str, default="manual", help="Run type")
    parser.add_argument("--output", type=str, default=None, help="Write manifests to directory")
    args = parser.parse_args()

    symbols = args.symbols or SYMBOL_TIERS.get(args.tier, [])
    plan = plan_shards(
        symbols=symbols,
        run_type=args.run_type,
        max_symbols_per_shard=args.max_per_shard,
        max_runtime_seconds=args.max_runtime,
    )

    print(plan.summary())
    print()

    if args.output:
        out_dir = Path(args.output)
        for shard in plan.shards:
            path = shard.save(out_dir / f"{shard.shard_name}.json")
            print(f"  Wrote: {path}")


if __name__ == "__main__":
    main()
