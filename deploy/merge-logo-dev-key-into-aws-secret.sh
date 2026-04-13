#!/usr/bin/env bash
# Merge LOGO_DEV_PUBLISHABLE_KEY into AWS Secrets Manager JSON secret (e.g. quanttrade/backend).
# Backend reads this key via config_aws.inject_aws_secrets — no frontend env needed for logos.
#
# Usage (publishable key only; never put sk_ secrets in client code):
#   export AWS_REGION=us-east-2
#   export LOGO_DEV_PUBLISHABLE_KEY='pk_...'
#   ./deploy/merge-logo-dev-key-into-aws-secret.sh
#
# Optional: AWS_SECRET_ID=quanttrade/backend
set -euo pipefail

SECRET_ID="${AWS_SECRET_ID:-quanttrade/backend}"
REGION="${AWS_REGION:-us-east-2}"
KEY="${LOGO_DEV_PUBLISHABLE_KEY:-}"

if [[ -z "$KEY" ]]; then
  echo "Error: set LOGO_DEV_PUBLISHABLE_KEY to your img.logo.dev publishable key (pk_...)." >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: AWS CLI not found. Install awscli v2 and configure credentials." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required to merge JSON." >&2
  exit 1
fi

CUR=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString \
  --output text)

NEW=$(echo "$CUR" | jq --arg k "$KEY" '. + {LOGO_DEV_PUBLISHABLE_KEY: $k}')

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --secret-string "$NEW"

echo "Updated $SECRET_ID in $REGION with LOGO_DEV_PUBLISHABLE_KEY (restart backend to pick up if env was cached)."
