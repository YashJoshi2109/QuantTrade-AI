#!/usr/bin/env python3
"""
Merge STRIPE_SECRET_KEY from backend/.env into ~/.cursor/mcp.json for Stripe remote MCP.

Stripe's hosted MCP (https://mcp.stripe.com) requires OAuth OR Authorization: Bearer <secret key>.
Empty headers cause tools to fail. This script does not print the key.

Usage:
  python3 scripts/sync-cursor-stripe-mcp.py
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        out[k] = v
    return out


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    env_path = repo / "backend" / ".env"
    mcp_path = Path.home() / ".cursor" / "mcp.json"

    if not mcp_path.is_file():
        print(f"Missing {mcp_path}")
        return 1

    env = parse_env_file(env_path)
    sk = env.get("STRIPE_SECRET_KEY", "").strip()
    if not sk:
        print("No STRIPE_SECRET_KEY in backend/.env — add it or use Stripe OAuth in Cursor MCP settings.")
        return 1

    data = json.loads(mcp_path.read_text(encoding="utf-8"))
    servers = data.setdefault("mcpServers", {})
    stripe = servers.setdefault("stripe", {})

    # Remote MCP with Bearer (per https://docs.stripe.com/mcp)
    stripe["url"] = "https://mcp.stripe.com"
    stripe["headers"] = {"Authorization": f"Bearer {sk}"}
    stripe.pop("command", None)
    stripe.pop("args", None)
    stripe.pop("env", None)
    if "type" in stripe and stripe.get("type") == "http":
        pass  # keep if present

    mcp_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.chmod(mcp_path, 0o600)
    print("Updated ~/.cursor/mcp.json — Stripe MCP now has Authorization header. Restart Cursor.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
