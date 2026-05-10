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
