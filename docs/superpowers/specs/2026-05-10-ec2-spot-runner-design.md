# EC2 Spot Ephemeral GHA Runner — Design Spec
**Date:** 2026-05-10  
**Status:** Approved  
**Scope:** Ephemeral self-hosted GitHub Actions runner on EC2 Spot for ML nightly training

---

## Problem

GHA shared runners have a 6-hour job timeout and no GPU/high-CPU SLA. The ML nightly pipeline (`ml-train-nightly.yml`) trains LSTM models across 300 symbols in 5 parallel shards. tier_2 (~180 symbols) takes ~2.5h, exceeding the old 3h timeout on slow shared runners. Shared runners also have no pip/torch cache, leading to repeated ~5-10min install overhead per job. Self-hosted removes all these constraints.

---

## Approach

**EventBridge → Lambda → EC2 Spot (ephemeral)**

A Lambda function fires 15 minutes before the nightly GHA cron, fetches a JIT runner registration token from GitHub, and launches a `c5.2xlarge` Spot instance. The instance bootstraps itself (installs deps, registers the GHA runner with `--ephemeral`), picks up the job, and self-terminates when done. No instance runs while idle.

Alternatives considered:
- **GHA self-provision** (run `aws ec2 run-instances` inside GHA job): rejected — fragile, no decoupling, AWS creds required in runner before runner exists.
- **philips-labs/terraform-aws-github-runner**: rejected — Terraform dependency overkill for a single nightly job.

---

## Architecture

```
02:45 UTC — EventBridge cron
    │
    ▼
Lambda: ml-runner-launcher (us-east-2)
  1. GetSecretValue: quanttrade/github-pat
  2. Check day-of-week: Sunday → N=5 runners, Mon-Fri → N=1 runner
  3. For each runner 1..N:
     POST /repos/.../actions/runners/registration-token → unique JIT token
     ec2.run_instances(LaunchTemplate=ml-runner-lt, UserData=bootstrap.sh+token_i)
    │
    ▼
EC2 Spot c5.2xlarge boots (~2-3 min)
  bootstrap.sh:
  1. Restore pip/torch cache from S3 (quanttrade-ml-artifacts/runner-cache/)
  2. apt-get python3.12, git
  3. pip install -r requirements.txt (torch CPU)
  4. Write pip cache back to S3
  5. ./config.sh --ephemeral --labels ml --token $JIT_TOKEN --unattended
  6. ./run.sh   ← blocks until job completes
  7. sudo shutdown -h now
    │
    ▼
03:00 UTC — GHA nightly cron fires
  runs-on: [self-hosted, ml]
  Runner online → picks up 5 shard jobs (no timeout limit)
    │
    ▼
Training complete → runner auto-deregisters → instance terminates
```

---

## Components

### CloudFormation Stack: `quanttrade-ml-runner`
File: `infra/ml-runner-cf.yaml`

Resources:
- **`MLRunnerInstanceRole`** — EC2 IAM role
  - `s3:GetObject/PutObject` on `quanttrade-ml-artifacts/*`
  - `secretsmanager:GetSecretValue` on `quanttrade/ml-pipeline-*`
  - `ec2:DescribeInstances` (self-tagging)
- **`MLRunnerInstanceProfile`** — binds role to instances
- **`MLRunnerSecurityGroup`** — egress HTTPS/443 only, no ingress
- **`MLRunnerLaunchTemplate`** — c5.2xlarge Spot, Ubuntu 22.04 (ami-0c55b159cbfafe1f0 us-east-2), 30GB gp3 EBS, max spot price $0.25/hr
- **`MLRunnerLauncherRole`** — Lambda IAM role
  - `secretsmanager:GetSecretValue` on `quanttrade/github-pat`
  - `ec2:RunInstances` with condition `LaunchTemplate=ml-runner-lt`
  - `ec2:CreateTags` (tag instances with RunDate for cost tracking), `iam:PassRole`
- **`MLRunnerLauncherFunction`** — Lambda (Python 3.12, 128MB, 60s timeout)
- **`MLRunnerLauncherSchedule`** — EventBridge rule: `cron(45 2 ? * MON-FRI *)` weekdays + `cron(45 2 ? * SUN *)` Sundays

### Lambda: `ml-runner-launcher`
File: `infra/lambdas/ml_runner_launcher/handler.py`

```python
def handler(event, context):
    pat = get_secret("quanttrade/github-pat")
    # Sunday = 5 runners (5 parallel shards), Mon-Fri = 1 runner
    n_runners = 5 if datetime.utcnow().weekday() == 6 else 1
    for i in range(n_runners):
        token = github_post(".../actions/runners/registration-token", pat)
        userdata = build_userdata(token["token"], runner_index=i)
        launch_spot(userdata, fallback_types=["c5.2xlarge", "c5.4xlarge", "m5.2xlarge"])
```

Each runner gets its own unique JIT token (tokens are single-use). Each `--ephemeral` runner picks up exactly one shard job and self-terminates. Fallback: tries instance types in order until `RunInstances` succeeds. On total failure: publishes to SNS topic `ml-runner-alerts`.

### Bootstrap Script: `ml-runner-userdata.sh`
Embedded in CloudFormation as `UserData` per-instance (token injected by Lambda at launch time via `run_instances` UserData, not tags — tags are visible in AWS console). Key steps:
1. Read `JIT_TOKEN` from UserData environment variable (set by Lambda before launch)
2. Restore pip + torch wheel from S3 (`runner-cache/pip/`, `runner-cache/torch/`)
3. `apt-get install -y python3.12 python3.12-venv git`
4. `pip install -r backend/requirements.txt` + `pip install torch --index-url ...`
5. Write cache back to S3 (only if changed)
6. Clone repo, configure runner: `./config.sh --ephemeral --labels ml --unattended --token $JIT_TOKEN`
7. `./run.sh`
8. `sudo shutdown -h now`

### Workflow Change
File: `.github/workflows/ml-train-nightly.yml`

```yaml
# Before
runs-on: ubuntu-latest

# After
runs-on: [self-hosted, ml]
```

---

## Error Handling

| Failure | Handling |
|---|---|
| GitHub API 401 (bad PAT) | Lambda raises exception → CloudWatch alarm → SNS alert |
| GitHub API 422 (runner limit hit) | Lambda lists and removes stale offline runners, retries once |
| EC2 InsufficientCapacity | Lambda retries with c5.4xlarge, then m5.2xlarge |
| All instance types fail | SNS alert → jobs fall back to ubuntu-latest via manual dispatch |
| Spot interruption mid-job | systemd spot-handler writes marker to S3, GHA marks job failed, retries next nightly |
| Bootstrap script fails | Instance logs to CloudWatch `/quanttrade/ml-runner/bootstrap`, then shuts down |

---

## Monitoring

- **CloudWatch Log Group:** `/aws/lambda/ml-runner-launcher` — Lambda execution logs
- **CloudWatch Log Group:** `/quanttrade/ml-runner/bootstrap` — EC2 bootstrap logs (via CloudWatch agent)
- **CloudWatch Alarm:** Lambda error count > 0 → SNS → email alert
- **EC2 Tags:** `Project=quanttrade`, `Role=ml-runner`, `RunDate=YYYY-MM-DD` — cost tracking via tag-based cost allocation

---

## Cost

| Scenario | Duration | Cost |
|---|---|---|
| Sunday full run (5 × c5.2xlarge, all run in parallel ~2.5h) | ~2.5h × 5 instances | ~$1.25 |
| Weekday tier_2 run (1 × c5.2xlarge, ~2.5h) | ~2.5h | ~$0.25 |
| Monthly (4 Sundays + 20 weekdays) | — | **~$10/month** |

vs GHA shared runners: free but 6h timeout, slow, no persistent cache.  
vs persistent Spot: ~$72/month (always-on).

---

## One-Time Setup Sequence

```bash
# 1. Store GitHub PAT (classic, repo scope) in Secrets Manager
aws secretsmanager create-secret \
  --name quanttrade/github-pat \
  --secret-string "ghp_xxxxxxxxxxxx" \
  --region us-east-2

# 2. Deploy CFN stack
aws cloudformation deploy \
  --template-file infra/ml-runner-cf.yaml \
  --stack-name quanttrade-ml-runner \
  --parameter-overrides \
    VpcId=vpc-xxx \
    SubnetId=subnet-xxx \
    GithubPATSecretArn=arn:aws:secretsmanager:us-east-2:xxx:secret:quanttrade/github-pat \
  --capabilities CAPABILITY_IAM \
  --region us-east-2

# 3. Test Lambda manually
aws lambda invoke --function-name ml-runner-launcher \
  --payload '{"test": true}' /tmp/out.json --region us-east-2

# 4. Merge workflow change (runs-on: [self-hosted, ml])
# 5. Verify runner appears in: GitHub → Settings → Actions → Runners
```

---

## Files Produced

| File | Purpose |
|---|---|
| `infra/ml-runner-cf.yaml` | CloudFormation: all AWS resources |
| `infra/ml-runner-userdata.sh` | EC2 bootstrap (also embedded in CFN) |
| `infra/lambdas/ml_runner_launcher/handler.py` | Lambda entrypoint |
| `infra/lambdas/ml_runner_launcher/requirements.txt` | `boto3` only (Lambda runtime has it) |
| `.github/workflows/ml-train-nightly.yml` | One-line change: runs-on |

---

## Out of Scope

- ML model DA improvements (separate spec)
- GPU instance support (not needed for CPU PyTorch training)
- Multi-repo runner sharing
- Terraform migration
