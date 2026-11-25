# QuantTrade AI — Production Runbook (AWS EC2 + Docker)

Production runs as Docker containers on one EC2 host behind nginx and Cloudflare.
Deploys are fully automated by GitHub Actions — there is no manual deploy path.

## Topology

| Component | Resource |
|---|---|
| AWS account / region | `208638972407` / `us-east-2` |
| App host | EC2 `quanttrade-prod` (t3.small, Ubuntu 24.04, 2 GB swap), Elastic IP `3.128.176.85` |
| Containers | `nginx`, `frontend` (Next.js), `backend` (FastAPI/gunicorn), `celery-worker` (worker + beat) — see `docker-compose.prod.yml` |
| Database | RDS PostgreSQL 17 `quanttrade-prod` (db.t4g.micro, pgvector, `rds.force_ssl=1`) — `infra/rds-stack.yaml` |
| Cache / broker | ElastiCache Redis `quanttrade-redis` (cache.t4g.micro) |
| Secrets | Secrets Manager `quanttrade/backend` (JSON). Backend + Celery load it at startup via `app/config_aws.py` → `inject_aws_secrets()`; EC2 role `QuantTradeEC2Role` grants read |
| DNS / TLS edge | Cloudflare (proxied, SSL mode Full). Origin cert: Let's Encrypt at `/etc/letsencrypt/live/quanttrade.us/` |
| Monitoring | CloudWatch dashboard `QuantTrade-Production` + alarms → SNS `quanttrade-alerts` — `infra/monitoring-stack.yaml` |
| ML | Batch / Step Functions / Lambdas / S3 `quanttrade-ml-artifacts-208638972407` — `infra/ml-pipeline-stack.yaml` |

## How a deploy works

Push to `main` → `.github/workflows/deploy.yml`:

1. Builds `quanttrade-backend` and `quanttrade-frontend` images, pushes to GHCR.
2. Copies `docker-compose.prod.yml` + `nginx/` to `/opt/quanttrade` over SSH.
3. Writes `/opt/quanttrade/.env` from GitHub Secrets (API keys; **not** `DATABASE_URL`, which comes from Secrets Manager).
4. `docker compose pull` → `up -d --wait`, runs idempotent DB column migrations, prunes old images.

The ssh step runs with `script_stop: true`: **any command that exits non-zero aborts the deploy**. Append `|| true` to diagnostic commands that may legitimately fail.

GitHub secrets the deploy needs: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, plus the API keys listed in `deploy.yml`.

## New host from scratch

```bash
# 1. Launch Ubuntu 24.04 t3.small with instance profile QuantTradeEC2Role,
#    app security group (80/443 public, 22 for GitHub Actions), user-data = deploy/docker-setup-ec2.sh
# 2. Associate the Elastic IP, then point Cloudflare A records (@, www) at it.
# 3. Issue the origin certificate (port 80 must be free — run before the first deploy):
sudo certbot certonly --standalone --non-interactive --agree-tos \
  -m <you@example.com> -d quanttrade.us -d www.quanttrade.us
# 4. Switch renewal to webroot so it works while nginx owns port 80:
sudo sed -i 's/^authenticator = standalone/authenticator = webroot/' /etc/letsencrypt/renewal/quanttrade.us.conf
echo 'webroot_path = /opt/quanttrade/nginx/certbot,' | sudo tee -a /etc/letsencrypt/renewal/quanttrade.us.conf
# 5. Update GitHub secrets EC2_HOST / EC2_SSH_KEY, then: gh workflow run deploy.yml
```

## Database

```bash
# Create schema + pgvector, then seed symbol tables (run from backend/ with DATABASE_URL set)
python scripts/init_rds_database.py
python scripts/seed_stock_universe.py
python scripts/seed_global_universe.py
python scripts/seed_symbols_master.py
```

Rotate the connection string by updating `DATABASE_URL` in Secrets Manager `quanttrade/backend`, then restart containers (`docker compose -f docker-compose.prod.yml restart backend celery-worker`).

## Operating the host

Shell access without SSH keys: `aws ssm start-session --target <instance-id> --region us-east-2`.

```bash
cd /opt/quanttrade
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 backend
curl -s localhost/health            # {"status": ..., "checks": {...}}
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Cloudflare **522** | EC2 unreachable / stopped, or security group blocks 80/443 |
| Cloudflare **521** | Host up, nginx container not running (usually backend failed its healthcheck → `depends_on` held nginx back) |
| Deploy fails `dial tcp …:22: i/o timeout` | Security group does not allow SSH from GitHub Actions runners |
| Deploy exits 1 right after a step with no error | `script_stop` tripped on a non-zero diagnostic command |
| Backend `Worker failed to boot` | Import-time error — read `docker logs quanttrade-backend` |
