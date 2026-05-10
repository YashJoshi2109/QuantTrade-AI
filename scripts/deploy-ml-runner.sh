#!/bin/bash
# scripts/deploy-ml-runner.sh
# One-shot setup: package Lambda → upload to S3 → deploy CFN stack.
# Run once. Re-run to update Lambda code or CFN resources.
#
# Prerequisites:
#   - AWS CLI configured (us-east-2)
#   - aws secretsmanager create-secret --name quanttrade/github-pat --secret-string "ghp_xxx"
#   - VPC_ID, SUBNET_ID, PAT_SECRET_ARN set as env vars
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
SNS_EMAIL="${SNS_EMAIL:-}"

echo "=== Packaging Lambda ==="
LAMBDA_DIR="$ROOT_DIR/infra/lambdas/ml_runner_launcher"
BUILD_DIR="$LAMBDA_DIR/package"
rm -rf "$BUILD_DIR"
pip install -r "$LAMBDA_DIR/requirements.txt" -t "$BUILD_DIR" --quiet
cp "$LAMBDA_DIR/handler.py" "$BUILD_DIR/"
cd "$BUILD_DIR"
zip -r "$LAMBDA_DIR/function.zip" . --quiet
cd "$LAMBDA_DIR"
rm -rf "$BUILD_DIR"
echo "Lambda packaged: $LAMBDA_DIR/function.zip"

echo "=== Uploading Lambda zip to S3 ==="
aws s3 cp \
  "$LAMBDA_DIR/function.zip" \
  "s3://${S3_BUCKET}/${LAMBDA_ZIP_KEY}" \
  --region "$REGION"
echo "Uploaded to s3://${S3_BUCKET}/${LAMBDA_ZIP_KEY}"

echo "=== Staging GHA runner binary to S3 (one-time) ==="
RUNNER_VERSION="2.323.0"
RUNNER_FILE="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
if ! aws s3 ls "s3://${S3_BUCKET}/runner-cache/actions-runner-linux-x64.tar.gz" --region "$REGION" &>/dev/null; then
  echo "Downloading runner binary v${RUNNER_VERSION}..."
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

echo "=== Verifying Lambda ==="
aws lambda get-function \
  --function-name ml-runner-launcher \
  --region "$REGION" \
  --query 'Configuration.{State:State,Runtime:Runtime}' \
  --output table 2>&1

echo ""
echo "=== DONE ==="
echo "Verify runner appears at: https://github.com/YashJoshi2109/QuantTrade-AI/settings/actions/runners"
echo "Next: merge runs-on change in ml-train-nightly.yml, then trigger nightly to verify end-to-end"
