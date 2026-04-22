# ML Nightly Pipeline — Architecture Decision Records

## ADR-001: CPU over GPU

**Decision**: Train LSTM models on CPU (c5.xlarge Spot instances).

**Context**: LSTMPredictor has 184K parameters. Batch tensors are ~1.2MB (256 x 60 x 20 x 4 bytes). Modern GPUs are optimized for batch sizes in the tens-of-MB range.

**Rationale**:
- GPU kernel launch overhead dominates actual compute for this model size
- CPU-to-GPU transfer latency (~50us per batch) exceeds the compute savings
- c5.xlarge Spot ($0.034/hr) vs g5.xlarge Spot ($0.19/hr) = 5.6x cost difference
- CPU training for 200 symbols completes in ~60min — well within Batch timeout
- GPU becomes beneficial when model exceeds ~1M params or batch_size >1024

**Reversal trigger**: If model architecture grows to >1M params or we add transformer layers, re-evaluate GPU. The container + Batch architecture supports GPU by simply changing instance types and installing CUDA torch.

## ADR-002: AWS Batch over GitHub Actions for Training

**Decision**: Migrate training execution from GitHub Actions runners to AWS Batch.

**Context**: GH Actions `ubuntu-latest` provides 2 vCPU / 7GB RAM with a 6-hour timeout. Training 804 symbols was hitting this limit.

**Rationale**:
- GH Actions is a CI/CD platform, not a batch compute platform
- No Spot pricing (pay full runner cost)
- 6-hour max timeout with no extension
- No retry at shard level (must restart entire workflow)
- No persistent compute (cold start every run)
- AWS Batch provides: Spot pricing (60-80% savings), configurable timeouts, per-job retry with exit code routing, persistent data caches via S3

**Bridge**: GH Actions workflow remains functional as fallback. EventBridge schedules can be disabled to fall back.

**Cost**: ~$1.80/month for all training runs (5 Spot shards per Sunday + 1 weekday job).

## ADR-003: Neon PostgreSQL over DynamoDB for Metadata

**Decision**: Store training pipeline metadata in Neon PostgreSQL (existing DB).

**Context**: Need to persist training run history, shard status, artifact lineage, and model version registry.

**Rationale**:
- Neon is already the primary database with 50+ tables and working connection patterns
- Relational model is natural for run→shard→artifact hierarchy (foreign keys)
- Complex queries (JOIN shards with artifacts, filter by status+date) trivial in SQL
- No additional service to manage (DynamoDB would require separate provisioning)
- Existing SQLAlchemy ORM + session management reusable
- Metadata volume is low (~100 rows/day) — well within Neon free tier

**Not stored in Neon**: High-volume telemetry (per-epoch metrics, per-batch timing). These go to CloudWatch logs/metrics.

## ADR-004: Manifest-Driven Sharding over Static Tier Splits

**Decision**: Use dynamic weighted shard planning instead of hardcoded tier_3a/3b/3c splits.

**Context**: Initial fix split tier_3 into 3 static sub-tiers. This works but doesn't balance by actual runtime.

**Rationale**:
- Static splits assume equal cost per symbol (wrong — mega-caps have more data)
- Manifest-driven planning uses estimated runtime per symbol for bin-packing
- Shards are balanced by cost, not count
- Supports future runtime-hint collection (actual timing → better estimates)
- Supports arbitrary backfill (any symbol subset, any shard count)
- Manifests are S3-persisted for reproducibility and auditability

**Bridge**: Static sub-tiers (tier_1_exclusive, tier_2_exclusive, tier_3a/3b/3c) remain in constants.py for the GH Actions workflow. The shard planner is used by the API and Step Functions path.

## ADR-005: S3 for Artifacts, Not R2

**Decision**: Use AWS S3 (not Cloudflare R2) for ML artifacts.

**Context**: R2 is already used for community image uploads. Both are S3-compatible.

**Rationale**:
- ML artifacts accessed by AWS Batch jobs — S3 has zero-latency access from EC2
- R2 would require cross-cloud data transfer (AWS→Cloudflare) on every checkpoint upload
- Step Functions and Lambda have native S3 integration (no custom endpoint needed)
- S3 lifecycle policies for automatic cleanup of old metrics/caches
- R2 remains optimal for user-facing image uploads (zero egress for CDN delivery)
