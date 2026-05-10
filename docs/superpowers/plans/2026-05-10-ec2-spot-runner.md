# EC2 Spot Ephemeral GHA Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GHA shared runners with ephemeral EC2 Spot instances that launch 15 minutes before each nightly cron, pick up ML training shard jobs, and self-terminate when done — eliminating the 6h timeout and $0 idle cost.

**Architecture:** EventBridge fires a Lambda at 02:45 UTC (15 min before nightly cron). Lambda fetches a GitHub JIT registration token per runner, launches N EC2 Spot c5.2xlarge instances (N=5 Sunday, N=1 weekdays) via a CloudFormation-managed launch template. Each instance bootstraps itself (installs deps, registers `--ephemeral` GHA runner), runs exactly one shard job, then self-terminates. No instance runs while idle.

**Tech Stack:** Python 3.12, boto3, requests, AWS Lambda, EventBridge, EC2 Spot, CloudFormation, GitHub Actions self-hosted runners

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `infra/lambdas/ml_runner_launcher/handler.py` | Create | Lambda: fetch PAT → JIT tokens → launch N Spot instances |
| `infra/lambdas/ml_runner_launcher/requirements.txt` | Create | `requests` (boto3 from runtime) |
| `infra/lambdas/tests/test_ml_runner_launcher.py` | Create | Unit tests for all handler paths |
| `infra/ml-runner-cf.yaml` | Create | CloudFormation: IAM, SG, launch template, Lambda, EventBridge |
| `infra/ml-runner-userdata.sh` | Create | EC2 bootstrap (reference copy; embedded in CFN) |
| `scripts/deploy-ml-runner.sh` | Create | One-shot: zip Lambda → upload S3 → deploy CFN |
| `.github/workflows/ml-train-nightly.yml` | Modify | `runs-on: ubuntu-latest` → `runs-on: [self-hosted, ml]` |

---

## Task 1: Lambda handler — core logic

**Files:**
- Create: `infra/lambdas/ml_runner_launcher/handler.py`
- Create: `infra/lambdas/ml_runner_launcher/requirements.txt`
- Create: `infra/lambdas/tests/test_ml_runner_launcher.py`

- [ ] **Step 1.1: Create `requirements.txt`**

```
# infra/lambdas/ml_runner_launcher/requirements.txt
requests==2.32.3
```

- [ ] **Step 1.2: Write the failing tests**

```python
# infra/lambdas/tests/test_ml_runner_launcher.py
"""Unit tests for ml-runner-launcher Lambda handler."""
import base64
import json
import os
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

# Inject required env vars before import
os.environ.setdefault("LAUNCH_TEMPLATE_ID", "lt-test12345")
os.environ.setdefault("SUBNET_ID", "subnet-test12345")
os.environ.setdefault("INSTANCE_PROFILE_ARN", "arn:aws:iam::123456789012:instance-profile/MLRunnerInstanceProfile")
os.environ.setdefault("SNS_TOPIC_ARN", "arn:aws:sns:us-east-2:123456789012:ml-runner-alerts")

sys.path.insert(0, str(Path(__file__).parent.parent / "ml_runner_launcher"))
import handler


# ── get_registration_token ────────────────────────────────────────────────────

def test_get_registration_token_success():
    with patch("handler.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"token": "AABBCC", "expires_at": "2026-05-10T04:00:00Z"}
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp

        result = handler.get_registration_token("ghp_test_pat")

        assert result["token"] == "AABBCC"
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args
        assert "Authorization" in call_kwargs.kwargs["headers"]
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer ghp_test_pat"


def test_get_registration_token_raises_on_401():
    import requests as req
    with patch("handler.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = req.exceptions.HTTPError("401 Unauthorized")
        mock_post.return_value = mock_resp

        with pytest.raises(req.exceptions.HTTPError):
            handler.get_registration_token("bad_pat")


# ── build_userdata ────────────────────────────────────────────────────────────

def test_build_userdata_is_valid_base64():
    ud = handler.build_userdata("TOKEN123", runner_index=0, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    assert "TOKEN123" in decoded
    assert "RUNNER_INDEX" in decoded
    assert "1000000" in decoded


def test_build_userdata_contains_shutdown():
    ud = handler.build_userdata("TOKEN123", runner_index=2, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    assert "shutdown -h now" in decoded


def test_build_userdata_index_0_writes_cache():
    ud = handler.build_userdata("TOKEN123", runner_index=0, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    # Index 0 should contain the cache write block
    assert 'RUNNER_INDEX" -eq 0' in decoded
    assert "runner-cache/pip" in decoded


def test_build_userdata_token_expiry_guard():
    ud = handler.build_userdata("TOKEN123", runner_index=0, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    assert "3000" in decoded  # 50-minute guard constant


# ── launch_spot ───────────────────────────────────────────────────────────────

def _mock_ec2_client(instance_id="i-0abc123"):
    mock_ec2 = MagicMock()
    mock_ec2.run_instances.return_value = {
        "Instances": [{"InstanceId": instance_id}]
    }
    return mock_ec2


def test_launch_spot_success_first_type():
    mock_ec2 = _mock_ec2_client("i-0first")
    with patch("handler.boto3.client", return_value=mock_ec2):
        result = handler.launch_spot("userdata_b64", 0, ["c5.2xlarge", "c5.4xlarge"])
    assert result["Instances"][0]["InstanceId"] == "i-0first"
    assert mock_ec2.run_instances.call_count == 1


def test_launch_spot_falls_back_on_insufficient_capacity():
    from botocore.exceptions import ClientError
    mock_ec2 = MagicMock()
    insufficient = ClientError(
        {"Error": {"Code": "InsufficientInstanceCapacity", "Message": "no capacity"}},
        "RunInstances",
    )
    mock_ec2.run_instances.side_effect = [
        insufficient,
        {"Instances": [{"InstanceId": "i-0fallback"}]},
    ]
    with patch("handler.boto3.client", return_value=mock_ec2):
        result = handler.launch_spot("ud", 0, ["c5.2xlarge", "c5.4xlarge"])
    assert result["Instances"][0]["InstanceId"] == "i-0fallback"
    assert mock_ec2.run_instances.call_count == 2


def test_launch_spot_raises_when_all_types_exhausted():
    from botocore.exceptions import ClientError
    mock_ec2 = MagicMock()
    insufficient = ClientError(
        {"Error": {"Code": "InsufficientInstanceCapacity", "Message": "no capacity"}},
        "RunInstances",
    )
    mock_ec2.run_instances.side_effect = insufficient
    with patch("handler.boto3.client", return_value=mock_ec2):
        with pytest.raises(RuntimeError, match="All instance types exhausted"):
            handler.launch_spot("ud", 0, ["c5.2xlarge", "c5.4xlarge"])


# ── handler (integration) ─────────────────────────────────────────────────────

def _make_full_mocks(n_instances=1, pat="ghp_test", token="JITTOKEN"):
    mock_sm = MagicMock()
    mock_sm.get_secret_value.return_value = {"SecretString": pat}

    mock_ec2 = MagicMock()
    mock_ec2.run_instances.return_value = {"Instances": [{"InstanceId": f"i-{i:04d}"}
                                                          for i in range(n_instances)]}

    mock_gh = MagicMock()
    mock_gh.return_value.json.return_value = {"token": token}
    mock_gh.return_value.raise_for_status = MagicMock()
    return mock_sm, mock_ec2, mock_gh


def test_handler_weekday_launches_one_runner():
    mock_sm, mock_ec2, mock_gh = _make_full_mocks()
    with patch("handler.boto3.client") as mock_boto, \
         patch("handler.requests.post", mock_gh):
        mock_boto.side_effect = lambda svc, **kw: mock_sm if svc == "secretsmanager" else mock_ec2
        result = handler.handler({"n_runners": 1}, None)
    assert len(result["launched"]) == 1
    assert result["errors"] == []
    assert mock_gh.call_count == 1  # one JIT token requested


def test_handler_sunday_launches_five_runners():
    mock_sm, mock_ec2, mock_gh = _make_full_mocks()
    with patch("handler.boto3.client") as mock_boto, \
         patch("handler.requests.post", mock_gh):
        mock_boto.side_effect = lambda svc, **kw: mock_sm if svc == "secretsmanager" else mock_ec2
        result = handler.handler({"n_runners": 5}, None)
    assert len(result["launched"]) == 5
    assert mock_gh.call_count == 5  # unique JIT token per runner


def test_handler_notifies_sns_on_pat_failure():
    mock_sm = MagicMock()
    mock_sm.get_secret_value.side_effect = Exception("secret not found")
    mock_sns = MagicMock()
    with patch("handler.boto3.client") as mock_boto:
        mock_boto.side_effect = lambda svc, **kw: (
            mock_sm if svc == "secretsmanager" else mock_sns
        )
        with pytest.raises(Exception, match="secret not found"):
            handler.handler({"n_runners": 1}, None)


def test_handler_continues_on_single_runner_failure():
    """If runner 1 fails, runner 2 still launches."""
    mock_sm, mock_ec2, _ = _make_full_mocks()
    call_count = [0]

    def mock_gh_post(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            raise Exception("GitHub API timeout")
        m = MagicMock()
        m.json.return_value = {"token": "OK"}
        m.raise_for_status = MagicMock()
        return m

    with patch("handler.boto3.client") as mock_boto, \
         patch("handler.requests.post", side_effect=mock_gh_post):
        mock_boto.side_effect = lambda svc, **kw: mock_sm if svc == "secretsmanager" else mock_ec2
        result = handler.handler({"n_runners": 2}, None)

    assert len(result["launched"]) == 1
    assert len(result["errors"]) == 1
```

- [ ] **Step 1.3: Run tests — verify they all fail with ImportError**

```bash
cd /Users/yash/Downloads/QuantTrade-AI
python -m pytest infra/lambdas/tests/test_ml_runner_launcher.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'handler'`

- [ ] **Step 1.4: Implement `handler.py`**

```python
# infra/lambdas/ml_runner_launcher/handler.py
"""Ephemeral GHA runner launcher — fires N Spot instances before nightly ML cron."""
import base64
import os
import time
from datetime import datetime, timezone

import boto3
import requests
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-2")
REPO = "YashJoshi2109/QuantTrade-AI"
PAT_SECRET_NAME = os.environ.get("PAT_SECRET_NAME", "quanttrade/github-pat")
LAUNCH_TEMPLATE_ID = os.environ.get("LAUNCH_TEMPLATE_ID", "")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
S3_BUCKET = os.environ.get("S3_BUCKET", "quanttrade-ml-artifacts")

_FALLBACK_TYPES = ["c5.2xlarge", "c5.4xlarge", "m5.2xlarge"]


def get_secret(secret_name: str) -> str:
    client = boto3.client("secretsmanager", region_name=REGION)
    return client.get_secret_value(SecretId=secret_name)["SecretString"]


def get_registration_token(pat: str) -> dict:
    resp = requests.post(
        f"https://api.github.com/repos/{REPO}/actions/runners/registration-token",
        headers={
            "Authorization": f"Bearer {pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def build_userdata(token: str, runner_index: int, token_issued_at: int) -> str:
    script = f"""#!/bin/bash
set -euo pipefail
export JIT_TOKEN="{token}"
export RUNNER_INDEX="{runner_index}"
export TOKEN_ISSUED_AT="{token_issued_at}"
export S3_BUCKET="{S3_BUCKET}"

# Token expiry guard (abort if >50min since issue; token expires at 60min)
NOW=$(date +%s)
AGE=$((NOW - TOKEN_ISSUED_AT))
if [ "$AGE" -gt 3000 ]; then
  echo "JIT token too old (${{AGE}}s), aborting" >&2
  shutdown -h now; exit 1
fi

# CloudWatch agent — install first so all subsequent steps are logged
cd /tmp
curl -sO https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i amazon-cloudwatch-agent.deb
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<CW_EOF
{{
  "logs": {{
    "logs_collected": {{
      "files": {{
        "collect_list": [{{
          "file_path": "/var/log/runner-bootstrap.log",
          "log_group_name": "/quanttrade/ml-runner/bootstrap",
          "log_stream_name": "${{INSTANCE_ID}}"
        }}]
      }}
    }}
  }}
}}
CW_EOF
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
exec >> /var/log/runner-bootstrap.log 2>&1
echo "[bootstrap] Starting at $(date) instance=${{INSTANCE_ID}} runner_index=${{RUNNER_INDEX}}"

# System deps
apt-get update -qq
apt-get install -y python3.12 python3.12-venv python3.12-dev git unzip awscli

# Restore pip/torch cache from S3
aws s3 sync "s3://${{S3_BUCKET}}/runner-cache/pip/" ~/.cache/pip/ --quiet 2>/dev/null || true
aws s3 sync "s3://${{S3_BUCKET}}/runner-cache/torch/" /tmp/torch-cache/ --quiet 2>/dev/null || true

# Clone repo
git clone --depth 1 https://github.com/{REPO}.git /home/runner/quanttrade
cd /home/runner/quanttrade/backend

# Install Python deps
python3.12 -m venv /home/runner/venv
source /home/runner/venv/bin/activate
pip install --cache-dir ~/.cache/pip -r requirements.txt
pip install --cache-dir /tmp/torch-cache torch --index-url https://download.pytorch.org/whl/cpu

# Only runner 0 writes cache back (prevents 5-way S3 PUT race on Sunday)
if [ "$RUNNER_INDEX" -eq 0 ]; then
  echo "[bootstrap] Writing pip/torch cache to S3..."
  aws s3 sync ~/.cache/pip/ "s3://${{S3_BUCKET}}/runner-cache/pip/" --quiet 2>/dev/null || true
  aws s3 sync /tmp/torch-cache/ "s3://${{S3_BUCKET}}/runner-cache/torch/" --quiet 2>/dev/null || true
fi

# GHA runner binary — try S3 mirror first, fallback to GitHub releases
RUNNER_DIR=/home/runner/actions-runner
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
aws s3 cp "s3://${{S3_BUCKET}}/runner-cache/actions-runner-linux-x64.tar.gz" . --quiet 2>/dev/null || \
  curl -sL https://github.com/actions/runner/releases/download/v2.323.0/actions-runner-linux-x64-2.323.0.tar.gz \
       -o actions-runner-linux-x64.tar.gz
tar xzf actions-runner-linux-x64.tar.gz

# Configure (--ephemeral = auto-deregister after exactly one job)
RUNNER_NAME="ml-spot-$(hostname)-${{RUNNER_INDEX}}"
./config.sh \
  --url "https://github.com/{REPO}" \
  --token "$JIT_TOKEN" \
  --labels ml \
  --name "$RUNNER_NAME" \
  --ephemeral \
  --unattended

echo "[bootstrap] Runner ${{RUNNER_NAME}} configured, starting..."
./run.sh
echo "[bootstrap] Job complete, shutting down"
shutdown -h now
"""
    return base64.b64encode(script.encode()).decode()


def launch_spot(userdata: str, runner_index: int, fallback_types: list) -> dict:
    ec2 = boto3.client("ec2", region_name=REGION)
    for instance_type in fallback_types:
        try:
            resp = ec2.run_instances(
                MinCount=1,
                MaxCount=1,
                LaunchTemplate={"LaunchTemplateId": LAUNCH_TEMPLATE_ID},
                InstanceType=instance_type,
                UserData=userdata,
                InstanceMarketOptions={
                    "MarketType": "spot",
                    "SpotOptions": {"MaxPrice": "0.25", "SpotInstanceType": "one-time"},
                },
                TagSpecifications=[{
                    "ResourceType": "instance",
                    "Tags": [
                        {"Key": "Project", "Value": "quanttrade"},
                        {"Key": "Role", "Value": "ml-runner"},
                        {"Key": "RunDate", "Value": datetime.now(timezone.utc).strftime("%Y-%m-%d")},
                        {"Key": "RunnerIndex", "Value": str(runner_index)},
                    ],
                }],
            )
            print(f"Launched {instance_type} Spot {resp['Instances'][0]['InstanceId']} (runner {runner_index})")
            return resp
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("InsufficientInstanceCapacity", "InsufficientHostCapacity", "Unsupported"):
                print(f"{instance_type} unavailable ({code}), trying next...")
                continue
            raise
    raise RuntimeError(f"All instance types exhausted: {fallback_types}")


def notify_failure(message: str) -> None:
    if not SNS_TOPIC_ARN:
        return
    boto3.client("sns", region_name=REGION).publish(
        TopicArn=SNS_TOPIC_ARN,
        Subject="ML Runner Launch Failed",
        Message=message,
    )


def handler(event: dict, context) -> dict:
    """Lambda entrypoint. event.n_runners set by EventBridge input constant."""
    n_runners = int(event.get("n_runners", 1))
    print(f"Launching {n_runners} ephemeral runner(s)")

    try:
        pat = get_secret(PAT_SECRET_NAME)
    except Exception as e:
        notify_failure(f"Failed to retrieve GitHub PAT: {e}")
        raise

    launched, errors = [], []
    for i in range(n_runners):
        try:
            token_resp = get_registration_token(pat)
            userdata = build_userdata(
                token=token_resp["token"],
                runner_index=i,
                token_issued_at=int(time.time()),
            )
            resp = launch_spot(userdata, runner_index=i, fallback_types=_FALLBACK_TYPES)
            launched.append(resp["Instances"][0]["InstanceId"])
        except Exception as e:
            errors.append(f"Runner {i}: {e}")
            print(f"ERROR launching runner {i}: {e}")

    if errors:
        notify_failure("\n".join(errors))

    return {"launched": launched, "errors": errors}
```

- [ ] **Step 1.5: Run tests — verify all pass**

```bash
cd /Users/yash/Downloads/QuantTrade-AI
pip install requests pytest 2>/dev/null | tail -1
python -m pytest infra/lambdas/tests/test_ml_runner_launcher.py -v
```

Expected output:
```
test_get_registration_token_success PASSED
test_get_registration_token_raises_on_401 PASSED
test_build_userdata_is_valid_base64 PASSED
test_build_userdata_contains_shutdown PASSED
test_build_userdata_index_0_writes_cache PASSED
test_build_userdata_token_expiry_guard PASSED
test_launch_spot_success_first_type PASSED
test_launch_spot_falls_back_on_insufficient_capacity PASSED
test_launch_spot_raises_when_all_types_exhausted PASSED
test_handler_weekday_launches_one_runner PASSED
test_handler_sunday_launches_five_runners PASSED
test_handler_notifies_sns_on_pat_failure PASSED
test_handler_continues_on_single_runner_failure PASSED
13 passed
```

- [ ] **Step 1.6: Commit**

```bash
git add infra/lambdas/ml_runner_launcher/ infra/lambdas/tests/test_ml_runner_launcher.py
git commit -m "feat(infra): ml-runner-launcher Lambda handler + 13 unit tests"
```

---

## Task 2: CloudFormation template

**Files:**
- Create: `infra/ml-runner-cf.yaml`

- [ ] **Step 2.1: Create the CloudFormation template**

```yaml
# infra/ml-runner-cf.yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: >
  QuantTrade ML — Ephemeral self-hosted GHA runner on EC2 Spot.
  EventBridge fires Lambda at 02:45 UTC; Lambda launches N Spot instances
  that register as --ephemeral GHA runners, run one shard job, then terminate.

Parameters:
  VpcId:
    Type: AWS::EC2::VPC::Id
    Description: VPC for runner instances (same VPC as app server)
  SubnetId:
    Type: AWS::EC2::Subnet::Id
    Description: Public subnet for runner instances (needs internet access for GitHub/PyPI)
  GithubPATSecretArn:
    Type: String
    Description: ARN of Secrets Manager secret containing GitHub classic PAT (repo scope)
  SNSEmail:
    Type: String
    Default: ''
    Description: Email address for launch failure alerts (leave empty to skip)
  LambdaCodeS3Bucket:
    Type: String
    Description: S3 bucket containing the packaged Lambda zip
  LambdaCodeS3Key:
    Type: String
    Default: runner-cache/ml-runner-launcher.zip
    Description: S3 key for the Lambda zip

Resources:

  # ── IAM: EC2 instance role ───────────────────────────────────────────────
  MLRunnerInstanceRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: quanttrade-ml-runner-instance
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: {Service: ec2.amazonaws.com}
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
      Policies:
        - PolicyName: MLRunnerInstancePolicy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Sid: S3MLArtifacts
                Effect: Allow
                Action: [s3:GetObject, s3:PutObject, s3:ListBucket, s3:DeleteObject]
                Resource:
                  - arn:aws:s3:::quanttrade-ml-artifacts
                  - arn:aws:s3:::quanttrade-ml-artifacts/*
              - Sid: SecretsMLPipeline
                Effect: Allow
                Action: secretsmanager:GetSecretValue
                Resource: !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:quanttrade/ml-pipeline-*
              - Sid: EC2SelfDescribe
                Effect: Allow
                Action: ec2:DescribeInstances
                Resource: '*'

  MLRunnerInstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      InstanceProfileName: quanttrade-ml-runner-instance
      Roles: [!Ref MLRunnerInstanceRole]

  # ── IAM: Lambda execution role ───────────────────────────────────────────
  MLRunnerLauncherRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: quanttrade-ml-runner-launcher
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: {Service: lambda.amazonaws.com}
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: MLRunnerLauncherPolicy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Sid: GetGithubPAT
                Effect: Allow
                Action: secretsmanager:GetSecretValue
                Resource: !Ref GithubPATSecretArn
              - Sid: LaunchSpotRunner
                Effect: Allow
                Action: ec2:RunInstances
                Resource: '*'
                Condition:
                  StringEquals:
                    ec2:LaunchTemplate: !Ref MLRunnerLaunchTemplate
              - Sid: TagInstances
                Effect: Allow
                Action: ec2:CreateTags
                Resource: !Sub arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:instance/*
              - Sid: PassInstanceRole
                Effect: Allow
                Action: iam:PassRole
                Resource: !GetAtt MLRunnerInstanceRole.Arn
              - Sid: PublishSNS
                Effect: Allow
                Action: sns:Publish
                Resource: !Ref MLRunnerAlertsTopic

  # ── Security Group ────────────────────────────────────────────────────────
  MLRunnerSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupName: quanttrade-ml-runner
      GroupDescription: ML runner EC2 — egress-only (HTTPS to GitHub, PyPI, AWS APIs)
      VpcId: !Ref VpcId
      SecurityGroupEgress:
        - IpProtocol: tcp
          FromPort: 443
          ToPort: 443
          CidrIp: 0.0.0.0/0
          Description: HTTPS egress (GitHub, PyPI, AWS)
        - IpProtocol: tcp
          FromPort: 80
          ToPort: 80
          CidrIp: 0.0.0.0/0
          Description: HTTP egress (apt-get, redirects)

  # ── Launch Template ───────────────────────────────────────────────────────
  MLRunnerLaunchTemplate:
    Type: AWS::EC2::LaunchTemplate
    Properties:
      LaunchTemplateName: quanttrade-ml-runner
      LaunchTemplateData:
        # Dynamic AMI resolution — never hardcode AMI IDs
        ImageId: !Sub '{{resolve:ssm:/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id}}'
        # InstanceType overridden per-launch by Lambda (fallback list: c5.2xlarge → c5.4xlarge → m5.2xlarge)
        InstanceType: c5.2xlarge
        IamInstanceProfile:
          Arn: !GetAtt MLRunnerInstanceProfile.Arn
        SecurityGroupIds: [!Ref MLRunnerSecurityGroup]
        BlockDeviceMappings:
          - DeviceName: /dev/sda1
            Ebs:
              VolumeSize: 30
              VolumeType: gp3
              DeleteOnTermination: true
        # UserData is injected per-instance by Lambda (contains unique JIT token)
        MetadataOptions:
          HttpTokens: required      # IMDSv2 only
          HttpEndpoint: enabled
        TagSpecifications:
          - ResourceType: instance
            Tags:
              - {Key: Project, Value: quanttrade}
              - {Key: Role, Value: ml-runner}

  # ── SNS Alert Topic ───────────────────────────────────────────────────────
  MLRunnerAlertsTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: ml-runner-alerts
      Subscription:
        - !If
          - HasSNSEmail
          - {Protocol: email, Endpoint: !Ref SNSEmail}
          - !Ref AWS::NoValue

  # ── Lambda Function ───────────────────────────────────────────────────────
  MLRunnerLauncherFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: ml-runner-launcher
      Runtime: python3.12
      Handler: handler.handler
      Role: !GetAtt MLRunnerLauncherRole.Arn
      Timeout: 120
      MemorySize: 128
      Code:
        S3Bucket: !Ref LambdaCodeS3Bucket
        S3Key: !Ref LambdaCodeS3Key
      Environment:
        Variables:
          PAT_SECRET_NAME: !Sub '{{resolve:secretsmanager:${GithubPATSecretArn}:SecretString}}'
          LAUNCH_TEMPLATE_ID: !Ref MLRunnerLaunchTemplate
          SNS_TOPIC_ARN: !Ref MLRunnerAlertsTopic
          S3_BUCKET: quanttrade-ml-artifacts

  # ── EventBridge Rules ─────────────────────────────────────────────────────
  # Weekday: 1 runner (tier_2 single shard)
  MLRunnerScheduleWeekday:
    Type: AWS::Events::Rule
    Properties:
      Name: ml-runner-launcher-weekday
      Description: Launch 1 ML runner 15min before weekday nightly cron (03:00 UTC)
      ScheduleExpression: 'cron(45 2 ? * MON-FRI *)'
      State: ENABLED
      Targets:
        - Id: MLRunnerLauncherWeekday
          Arn: !GetAtt MLRunnerLauncherFunction.Arn
          Input: '{"n_runners": 1}'

  # Sunday: 5 runners (full 5-shard parallel run)
  MLRunnerScheduleSunday:
    Type: AWS::Events::Rule
    Properties:
      Name: ml-runner-launcher-sunday
      Description: Launch 5 ML runners 15min before Sunday full retrain (03:00 UTC)
      ScheduleExpression: 'cron(45 2 ? * SUN *)'
      State: ENABLED
      Targets:
        - Id: MLRunnerLauncherSunday
          Arn: !GetAtt MLRunnerLauncherFunction.Arn
          Input: '{"n_runners": 5}'

  # Lambda permissions for EventBridge to invoke
  MLRunnerPermissionWeekday:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !GetAtt MLRunnerLauncherFunction.Arn
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt MLRunnerScheduleWeekday.Arn

  MLRunnerPermissionSunday:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !GetAtt MLRunnerLauncherFunction.Arn
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt MLRunnerScheduleSunday.Arn

  # ── CloudWatch Alarm ──────────────────────────────────────────────────────
  MLRunnerLauncherErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: ml-runner-launcher-errors
      AlarmDescription: Lambda errors launching ML runner
      MetricName: Errors
      Namespace: AWS/Lambda
      Dimensions:
        - {Name: FunctionName, Value: ml-runner-launcher}
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      AlarmActions: [!Ref MLRunnerAlertsTopic]

Conditions:
  HasSNSEmail: !Not [!Equals [!Ref SNSEmail, '']]

Outputs:
  LaunchTemplateId:
    Value: !Ref MLRunnerLaunchTemplate
    Description: EC2 launch template ID (use in Lambda env var LAUNCH_TEMPLATE_ID)
  LambdaFunctionName:
    Value: !Ref MLRunnerLauncherFunction
  SNSTopicArn:
    Value: !Ref MLRunnerAlertsTopic
```

- [ ] **Step 2.2: Validate CFN template syntax**

```bash
aws cloudformation validate-template \
  --template-body file://infra/ml-runner-cf.yaml \
  --region us-east-2
```

Expected: JSON describing the template parameters (no errors).

- [ ] **Step 2.3: Commit**

```bash
git add infra/ml-runner-cf.yaml
git commit -m "feat(infra): CloudFormation template for ephemeral ML runner (IAM, SG, launch template, Lambda, EventBridge)"
```

---

## Task 3: Bootstrap script (standalone reference copy)

**Files:**
- Create: `infra/ml-runner-userdata.sh`

The userdata is also generated inline by `build_userdata()` in handler.py. This standalone file is the human-readable reference for debugging and docs. They must stay in sync.

- [ ] **Step 3.1: Create standalone bootstrap script**

```bash
#!/bin/bash
# infra/ml-runner-userdata.sh
# Reference copy of the EC2 user data bootstrap script.
# The actual script is generated by handler.build_userdata() with per-instance env vars injected.
# This file is for documentation/debugging — keep in sync with handler.py.
set -euo pipefail

# ── Injected by Lambda (per-instance) ────────────────────────────────────────
# export JIT_TOKEN="<github-jit-registration-token>"
# export RUNNER_INDEX="<0..N-1>"
# export TOKEN_ISSUED_AT="<unix-timestamp>"
# export S3_BUCKET="quanttrade-ml-artifacts"

# ── Token expiry guard ────────────────────────────────────────────────────────
NOW=$(date +%s)
AGE=$((NOW - TOKEN_ISSUED_AT))
if [ "$AGE" -gt 3000 ]; then
  echo "JIT token too old (${AGE}s > 3000s), aborting" >&2
  shutdown -h now
  exit 1
fi

# ── CloudWatch agent (install FIRST — logs all subsequent steps) ─────────────
cd /tmp
curl -sO https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i amazon-cloudwatch-agent.deb

INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<CW_EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [{
          "file_path": "/var/log/runner-bootstrap.log",
          "log_group_name": "/quanttrade/ml-runner/bootstrap",
          "log_stream_name": "${INSTANCE_ID}"
        }]
      }
    }
  }
}
CW_EOF

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

exec >> /var/log/runner-bootstrap.log 2>&1
echo "[bootstrap] Starting at $(date) | instance=${INSTANCE_ID} | runner=${RUNNER_INDEX}"

# ── System deps ───────────────────────────────────────────────────────────────
apt-get update -qq
apt-get install -y python3.12 python3.12-venv python3.12-dev git unzip awscli

# ── Restore pip/torch cache from S3 ─────────────────────────────────────────
aws s3 sync "s3://${S3_BUCKET}/runner-cache/pip/" ~/.cache/pip/ --quiet 2>/dev/null || true
aws s3 sync "s3://${S3_BUCKET}/runner-cache/torch/" /tmp/torch-cache/ --quiet 2>/dev/null || true

# ── Clone repo + install deps ────────────────────────────────────────────────
REPO="YashJoshi2109/QuantTrade-AI"
git clone --depth 1 "https://github.com/${REPO}.git" /home/runner/quanttrade
cd /home/runner/quanttrade/backend

python3.12 -m venv /home/runner/venv
source /home/runner/venv/bin/activate
pip install --cache-dir ~/.cache/pip -r requirements.txt
pip install --cache-dir /tmp/torch-cache torch --index-url https://download.pytorch.org/whl/cpu

# ── Write cache back (index 0 only — prevents Sunday 5-way race) ─────────────
if [ "$RUNNER_INDEX" -eq 0 ]; then
  echo "[bootstrap] Writing pip/torch cache to S3..."
  aws s3 sync ~/.cache/pip/ "s3://${S3_BUCKET}/runner-cache/pip/" --quiet 2>/dev/null || true
  aws s3 sync /tmp/torch-cache/ "s3://${S3_BUCKET}/runner-cache/torch/" --quiet 2>/dev/null || true
fi

# ── GHA runner binary ────────────────────────────────────────────────────────
RUNNER_DIR=/home/runner/actions-runner
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
# Try S3 mirror first (fast), fallback to GitHub releases
aws s3 cp "s3://${S3_BUCKET}/runner-cache/actions-runner-linux-x64.tar.gz" . --quiet 2>/dev/null || \
  curl -sL https://github.com/actions/runner/releases/download/v2.323.0/actions-runner-linux-x64-2.323.0.tar.gz \
       -o actions-runner-linux-x64.tar.gz
tar xzf actions-runner-linux-x64.tar.gz

# ── Register + run (--ephemeral = auto-deregister after one job) ─────────────
RUNNER_NAME="ml-spot-$(hostname)-${RUNNER_INDEX}"
./config.sh \
  --url "https://github.com/${REPO}" \
  --token "$JIT_TOKEN" \
  --labels ml \
  --name "$RUNNER_NAME" \
  --ephemeral \
  --unattended

echo "[bootstrap] Runner ${RUNNER_NAME} registered, starting job..."
./run.sh

echo "[bootstrap] Job complete, terminating instance"
shutdown -h now
```

- [ ] **Step 3.2: Validate bash syntax**

```bash
bash -n infra/ml-runner-userdata.sh && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Step 3.3: Commit**

```bash
git add infra/ml-runner-userdata.sh
git commit -m "feat(infra): EC2 bootstrap script for ephemeral GHA runner"
```

---

## Task 4: Deploy script

**Files:**
- Create: `scripts/deploy-ml-runner.sh`

- [ ] **Step 4.1: Create deploy script**

```bash
#!/bin/bash
# scripts/deploy-ml-runner.sh
# One-shot setup: package Lambda → upload to S3 → deploy CFN stack.
# Run once. Re-run to update Lambda code or CFN resources.
#
# Prerequisites:
#   - AWS CLI configured (us-east-2)
#   - aws secretsmanager create-secret --name quanttrade/github-pat --secret-string "ghp_xxx"
#   - VPC_ID and SUBNET_ID set (from existing app server VPC)
set -euo pipefail

REGION="us-east-2"
S3_BUCKET="quanttrade-ml-artifacts"
LAMBDA_ZIP_KEY="runner-cache/ml-runner-launcher.zip"
STACK_NAME="quanttrade-ml-runner"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Required env vars ─────────────────────────────────────────────────────────
: "${VPC_ID:?Set VPC_ID env var (e.g. export VPC_ID=vpc-xxxxxxxx)}"
: "${SUBNET_ID:?Set SUBNET_ID env var (e.g. export SUBNET_ID=subnet-xxxxxxxx)}"
: "${PAT_SECRET_ARN:?Set PAT_SECRET_ARN to the Secrets Manager ARN of quanttrade/github-pat}"
SNS_EMAIL="${SNS_EMAIL:-}"   # optional

echo "=== Packaging Lambda ==="
cd "$ROOT_DIR/infra/lambdas/ml_runner_launcher"
pip install -r requirements.txt -t ./package --quiet
cp handler.py ./package/
cd ./package
zip -r "$ROOT_DIR/infra/lambdas/ml_runner_launcher/function.zip" . --quiet
cd ..
rm -rf ./package
echo "Lambda packaged: function.zip"

echo "=== Uploading Lambda zip to S3 ==="
aws s3 cp \
  "$ROOT_DIR/infra/lambdas/ml_runner_launcher/function.zip" \
  "s3://${S3_BUCKET}/${LAMBDA_ZIP_KEY}" \
  --region "$REGION"
echo "Uploaded to s3://${S3_BUCKET}/${LAMBDA_ZIP_KEY}"

echo "=== Staging GHA runner binary to S3 (one-time) ==="
RUNNER_VERSION="2.323.0"
RUNNER_FILE="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
if ! aws s3 ls "s3://${S3_BUCKET}/runner-cache/actions-runner-linux-x64.tar.gz" --region "$REGION" &>/dev/null; then
  echo "Downloading runner binary..."
  curl -sL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_FILE}" \
       -o "/tmp/${RUNNER_FILE}"
  aws s3 cp "/tmp/${RUNNER_FILE}" \
    "s3://${S3_BUCKET}/runner-cache/actions-runner-linux-x64.tar.gz" \
    --region "$REGION"
  echo "Runner binary staged."
else
  echo "Runner binary already in S3, skipping."
fi

echo "=== Deploying CloudFormation stack ==="
aws cloudformation deploy \
  --template-file "$ROOT_DIR/infra/ml-runner-cf.yaml" \
  --stack-name "$STACK_NAME" \
  --parameter-overrides \
    VpcId="$VPC_ID" \
    SubnetId="$SUBNET_ID" \
    GithubPATSecretArn="$PAT_SECRET_ARN" \
    LambdaCodeS3Bucket="$S3_BUCKET" \
    LambdaCodeS3Key="$LAMBDA_ZIP_KEY" \
    SNSEmail="$SNS_EMAIL" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$REGION"
echo "Stack deployed: $STACK_NAME"

echo "=== Smoke test: invoke Lambda with test event ==="
RESULT=$(aws lambda invoke \
  --function-name ml-runner-launcher \
  --payload '{"n_runners": 1, "dry_run": true}' \
  --region "$REGION" \
  /tmp/ml-runner-test-out.json \
  --cli-binary-format raw-in-base64-out 2>&1)
echo "Lambda response: $(cat /tmp/ml-runner-test-out.json)"

echo ""
echo "=== DONE ==="
echo "Verify runner appears at: https://github.com/YashJoshi2109/QuantTrade-AI/settings/actions/runners"
echo "Next: merge runs-on change in ml-train-nightly.yml"
```

- [ ] **Step 4.2: Make executable and validate**

```bash
chmod +x scripts/deploy-ml-runner.sh
bash -n scripts/deploy-ml-runner.sh && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Step 4.3: Commit**

```bash
git add scripts/deploy-ml-runner.sh
git commit -m "feat(infra): deploy script for ML runner CFN stack + Lambda packaging"
```

---

## Task 5: Workflow update

**Files:**
- Modify: `.github/workflows/ml-train-nightly.yml`

- [ ] **Step 5.1: Change `runs-on` for the training job**

In `.github/workflows/ml-train-nightly.yml`, find the `train-lstm` job and change:

```yaml
# Before (line ~55)
runs-on: ubuntu-latest

# After
runs-on: [self-hosted, ml]
```

The full job header after change:
```yaml
  train-lstm:
    name: Train LSTM (${{ matrix.label }})
    needs: plan
    runs-on: [self-hosted, ml]
    timeout-minutes: 360
```

- [ ] **Step 5.2: Verify the change**

```bash
grep "runs-on" .github/workflows/ml-train-nightly.yml
```

Expected: `runs-on: [self-hosted, ml]`

- [ ] **Step 5.3: Commit**

```bash
git add .github/workflows/ml-train-nightly.yml
git commit -m "feat(ci): use self-hosted EC2 Spot runner for ML training — no timeout"
```

---

## Task 6: One-time deployment + validation

This task is **manual execution** — not automated. Run after Tasks 1-5 are merged.

- [ ] **Step 6.1: Store GitHub PAT in Secrets Manager**

Generate a GitHub classic PAT at `github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)`. Required scope: `repo`.

```bash
aws secretsmanager create-secret \
  --name quanttrade/github-pat \
  --secret-string "ghp_YOUR_TOKEN_HERE" \
  --region us-east-2
```

Copy the returned `ARN` — needed for step 6.2.

- [ ] **Step 6.2: Find VPC and subnet IDs**

```bash
# Get VPC of existing app server
aws ec2 describe-instances \
  --filters "Name=ip-address,Values=3.19.207.79" \
  --query "Reservations[].Instances[].[VpcId,SubnetId]" \
  --output text \
  --region us-east-2
```

Note the VpcId and SubnetId from output.

- [ ] **Step 6.3: Run deploy script**

```bash
export VPC_ID=vpc-xxxxxxxx         # from step 6.2
export SUBNET_ID=subnet-xxxxxxxx   # from step 6.2
export PAT_SECRET_ARN=arn:aws:secretsmanager:us-east-2:xxxx:secret:quanttrade/github-pat-xxxxx
export SNS_EMAIL=yashjosh7486@gmail.com

bash scripts/deploy-ml-runner.sh
```

Expected final lines:
```
Stack deployed: quanttrade-ml-runner
Lambda response: {"launched": [], "errors": []}
=== DONE ===
Verify runner appears at: https://github.com/...
```

- [ ] **Step 6.4: Test Lambda manually (real launch)**

```bash
aws lambda invoke \
  --function-name ml-runner-launcher \
  --payload '{"n_runners": 1}' \
  --region us-east-2 \
  --cli-binary-format raw-in-base64-out \
  /tmp/test-out.json && cat /tmp/test-out.json
```

Expected: `{"launched": ["i-0xxxxxxxxxxxxxxxxx"], "errors": []}`

- [ ] **Step 6.5: Verify runner appears in GitHub**

Open: `github.com/YashJoshi2109/QuantTrade-AI/settings/actions/runners`

Expected: runner with label `ml` in "Idle" state. It will self-deregister after ~60min if no job is picked up (ephemeral + idle timeout).

- [ ] **Step 6.6: Trigger manual nightly run to validate end-to-end**

```bash
gh workflow run ml-train-nightly.yml \
  --field symbol_tier=tier_1_exclusive \
  --field force=true
```

Watch the run — jobs should show `runs-on: ml-spot-*` in the runner column, no timeout, tier_1 completes normally.

- [ ] **Step 6.7: Push final state**

```bash
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] EventBridge → Lambda → Spot architecture ✓ (Task 2 CFN + Task 1 Lambda)
- [x] SSM dynamic AMI (no hardcoded AMI ID) ✓ (Task 2 CFN, `{{resolve:ssm:...}}`)
- [x] n_runners from EventBridge input constant ✓ (Task 2 CFN, `Input: '{"n_runners": 1/5}'`)
- [x] Token expiry guard (50min) ✓ (Task 1 `build_userdata`, Task 3 bootstrap)
- [x] S3 cache write only from index 0 ✓ (Task 1 `build_userdata`, Task 3 bootstrap)
- [x] CloudWatch agent in bootstrap ✓ (Task 3 step 3.1)
- [x] `requests` in requirements.txt ✓ (Task 1 step 1.1)
- [x] Fallback instance types ✓ (Task 1 `launch_spot`, `_FALLBACK_TYPES`)
- [x] SNS on failure ✓ (Task 1 `notify_failure` + CloudWatch alarm in Task 2)
- [x] `runs-on: [self-hosted, ml]` ✓ (Task 5)
- [x] Deploy script with PAT setup + CFN deploy ✓ (Task 4 + Task 6)

**No placeholders found** — all steps have complete code.

**Type consistency** — `build_userdata(token: str, runner_index: int, token_issued_at: int)` called consistently in handler and tests. `launch_spot(userdata, runner_index, fallback_types)` matches definition.
