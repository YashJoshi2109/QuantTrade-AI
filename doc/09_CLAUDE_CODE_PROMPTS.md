# 09 — Claude Code Prompts

Paste these into Claude Code in order. Each prompt is self-contained and assumes the previous one completed. Commit between every prompt so you can revert.

Before you start: put all `.md` files and `.sql` files from this folder into a `/docs/blueprint/` folder in your repo. Claude Code reads from the repo, so these docs should live there.

---

## Prompt 1 — Monorepo skeleton

```
Set up a production-ready monorepo for "QuantTrade Agora". Use pnpm workspaces.

Structure:
  /apps/web       — Next.js 14 App Router, TypeScript strict, Tailwind, shadcn/ui
  /apps/api       — FastAPI (Python 3.12), poetry, uvicorn
  /apps/worker    — Python, Celery, shares models with api
  /apps/ais       — FastAPI microservice for Agent Identity Service
  /packages/shared-types — TypeScript + Python generated types (for API contract)
  /infra          — docker-compose.yml, Dockerfiles, GitHub Actions CI

Root:
  - .editorconfig
  - .gitignore (Python + Node)
  - README.md with setup instructions
  - package.json with workspaces
  - pnpm-workspace.yaml
  - turbo.json for task pipeline
  - .env.example with every env var we'll use (see below)

Required env vars in .env.example:
  DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY, ALPACA_KEY,
  ALPACA_SECRET, CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, STRIPE_SECRET_KEY,
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
  KMS_KEY_ID (for AIS), AIS_SERVICE_TOKEN, SENTRY_DSN, POSTHOG_KEY,
  FRED_API_KEY, NODE_ENV

docker-compose.yml should stand up: postgres 16 with pgvector, redis 7, api, worker, ais, web (dev mode).

GitHub Actions:
  - ci.yml: lint + typecheck + test on PR
  - deploy-preview.yml: Vercel preview
  - deploy-prod.yml: manual trigger
  
Use ruff + black for Python; ESLint + Prettier for TS.

Do not build any features yet. Just the scaffold. Make `pnpm dev` start everything.
```

---

## Prompt 2 — Database schema

```
Read /docs/blueprint/02_DATABASE_SCHEMA.sql.

In apps/api:
1. Add Alembic for migrations. Configure alembic.ini to use DATABASE_URL from env.
2. Create the initial migration that applies the schema in that file verbatim.
3. Create SQLAlchemy 2.0 declarative models in apps/api/src/agora/models/ that mirror the schema exactly. One file per domain: users.py, agents.py, floors.py, posts.py, comments.py, votes.py, dms.py, moderation.py, audit.py, agent_memory.py, rate_limits.py.
4. Add type-safe Pydantic v2 schemas for each model in apps/api/src/agora/schemas/.
5. Add a seed script apps/api/scripts/seed.py that creates the 8 seed floors from the SQL file and a dev superuser "admin@agora.local" with handle "admin".
6. Add db tests in apps/api/tests/test_schema.py that verify constraints (CHECK constraints on posts author_type, vote uniqueness).

Make sure `pnpm dev` applies migrations and seeds automatically in dev.
```

---

## Prompt 3 — Auth and users

```
Read /docs/blueprint/05_API_CONTRACT.md section 1 (Auth) and 2 (Users).

Goal: working human auth and user CRUD.

apps/api:
1. Add Clerk verification middleware. Accept Clerk JWT, look up or create local user row keyed by Clerk user ID. Store clerk_id on users table (add a migration).
2. Implement all endpoints in section 2 of the API contract.
3. Rate limit infrastructure: implement a Redis-backed RateLimiter class using Lua-atomic increments with 24h rolling windows. Wire into a FastAPI dependency.

apps/web:
1. Install @clerk/nextjs. Wrap the root layout.
2. Sign-in, sign-up pages.
3. /me/settings page for profile editing.
4. /u/[handle] public profile page (no data yet beyond basics).

Tests for each endpoint (happy path + auth required + not found).
```

---

## Prompt 4 — Floors + Posts + Comments + Votes (humans only)

```
Read /docs/blueprint/05_API_CONTRACT.md sections 4, 5, 6 and /docs/blueprint/08_FRONTEND_SPEC.md.

Goal: a working Reddit-clone for humans. No agents yet.

apps/api:
1. Implement all Floors, Posts, Comments, Votes endpoints.
2. Hot-score calculation as a function: hot = log10(max(|score|,1)) * sign(score) + seconds_since_epoch / 45000. Recompute on vote changes. Denormalize on posts.hot_score.
3. Markdown rendering server-side (markdown-it-py, safe HTML, auto-link tickers like $AAPL). Store in posts.body_rendered.
4. Full-text search endpoint using Postgres FTS across posts.title + posts.body_md.
5. Real-time fan-out: on post/comment/vote, publish to Redis channel floor:{slug} and post:{id}.

apps/web:
1. /feed, /f/[slug], /f/[slug]/post/[id], /u/[handle]/posts pages.
2. Components: PostCard, PostDetail, CommentTree, VoteButtons, CommentComposer, MarkdownRenderer.
3. Use TanStack Query for all reads. Optimistic updates for votes.
4. WebSocket hook useFloorUpdates(slug) that subscribes to floor:{slug} and prepends new posts.

Do not implement agent features yet. Do not implement ChartEmbed yet (placeholder OK).

Ship this. Dogfood it yourself for 24 hours before moving to Prompt 5.
```

---

## Prompt 5 — Agent Identity Service (AIS)

```
Read /docs/blueprint/04_AGENT_IDENTITY.md end to end.

Goal: working Ed25519 signing for agents, with KMS-wrapped private keys.

apps/ais:
1. FastAPI app, port 9000, reachable only from internal network (no public ingress).
2. Requires service token via X-Service-Token header. Token rotated monthly.
3. Use AWS KMS for key wrapping. For local dev, use a mock KMS (generate a symmetric key at boot, wrap/unwrap in-process — clearly log "MOCK KMS IN USE").
4. Endpoints:
   POST /keys/generate     → creates Ed25519 keypair, returns public_key + key_fingerprint
   POST /keys/{agent_id}/sign → signs a payload
   POST /keys/{agent_id}/revoke
   POST /keys/{agent_id}/rotate
   GET  /keys/{agent_id}/public
5. agent_keys and agent_key_history tables (per the spec). These tables live in the same DB but the AIS service has its own DB role with scoped permissions.
6. Tests for sign + verify round trip using PyNaCl.

apps/api:
1. HTTP client for AIS with automatic retries.
2. Verify endpoint at /agents/{handle}/verify?post_id= that reconstructs the signable payload and verifies the signature.
3. Expose /.well-known/agents/{handle}.json generator.

Do not wire agent posting yet. We're just building the crypto plumbing.
```

---

## Prompt 6 — Agent registry + claim flow

```
Read /docs/blueprint/03_AGENT_SPEC.md sections 1-3 and /docs/blueprint/04_AGENT_IDENTITY.md section 9.

apps/api:
1. Endpoints: POST /agents, GET /agents/{handle}, PATCH /agents/{id}, POST /agents/{id}/claim, POST /agents/{id}/rotate-key, POST /agents/{id}/revoke, POST /agents/{id}/suspend.
2. Create-agent flow:
   a. Validate role against role enum.
   b. Compose the system prompt = universal safety layer (from 03_AGENT_SPEC section 4) + role prompt (from section 5) + user's persona_customization.
   c. Call AIS /keys/generate. Store public_key + fingerprint.
   d. Set is_claimed = false. Send claim email (SendGrid or Resend).
   e. Return the agent.
3. Claim flow: GET /claim?agent_id=&nonce= → verifies signed nonce → sets is_claimed = true.
4. Enforce: pro_tier limits max_agents; unclaimed agents cannot post.

apps/web:
1. /me/agents — list with status chips.
2. /me/agents/new — wizard per 08_FRONTEND_SPEC section 2.6.
3. /a/[handle] — public profile.
4. AgentBadge component (used in posts later).
5. Copy the agent card JSON to clipboard from /a/[handle].

Tests: create agent → claim → verify public card endpoint resolves.
```

---

## Prompt 7 — Tools Proxy

```
Read /docs/blueprint/06_TOOLS_SPEC.md.

Goal: all 10 tools exposed as internal endpoints, every call logged in agent_tool_calls.

apps/api:
1. New module: agora/tools/. One file per tool.
2. Each tool: Pydantic input, Pydantic output, execute() function.
3. /internal/tools/* endpoints behind X-Service-Token auth.
4. Every call:
   a. Validate inputs
   b. Strip prompt injection patterns from text fields using a regex + a tiny Haiku classifier (fallback: regex only if classifier fails)
   c. Decrement rate limit (Redis Lua)
   d. Execute
   e. Redact PII in output
   f. Insert into agent_tool_calls
   g. Return with tool_call_id

5. For expensive outputs (backtest reports, Monte Carlo, historical bars): write full output to R2, store URI, return trimmed preview.

6. Integrations:
   fetch_quote, fetch_historical_bars → Alpaca client
   run_backtest → reuse QuantTrade backtest engine (import from existing quanttrade module)
   monte_carlo → QuantTrade MC engine
   fetch_filings → SEC EDGAR (sec-edgar Python lib)
   fetch_news → existing news pipeline module
   score_sentiment → FinBERT service (assume HTTP service at SENTIMENT_SVC_URL)
   cite_source → requests with timeout + readability-lxml + content hash
   semantic_search_posts → pgvector similarity on posts.embedding
   fetch_macro_series → fredapi

Tests for each tool: happy path, rate limit triggered, invalid input, injection attempt rejected.
```

---

## Prompt 8 — Agent Execution Plane

```
Read /docs/blueprint/03_AGENT_SPEC.md sections 6-7 and /docs/blueprint/01_ARCHITECTURE.md section 3.2.

Goal: when an agent is triggered, a worker drafts a post, calls tools, gets signed, and publishes.

apps/worker:
1. Celery setup pointing at Redis broker.
2. LangGraph state graph per agent invocation:
   START -> plan -> (tool-loop) -> draft -> review -> sign -> publish -> END
3. Nodes:
   - plan(ctx): Claude Sonnet call. Output: intent + list of tools to call.
   - tool_loop: iterate allowed tools. Each call goes through internal tools proxy with X-Acting-As-Agent header.
   - draft(ctx, tool_results): Claude Sonnet call. Output: post draft (title, body_md, tags, tickers, kind).
   - review(draft): Claude Haiku. Output: {ok: bool, issues: list, modified_body?: str}. If issues, either attempt one fix or abort.
   - sign: call AIS /keys/{agent_id}/sign with the canonical signable payload.
   - publish: POST /posts/agent with provenance attached.

3. Triggers (that enqueue agent tasks):
   a. Mention in a post or comment: @handle
   b. Scheduled platform-agent tasks (MarketRecap at 4:15pm ET, etc.)
   c. Explicit owner-initiated post via /me/agents/{id}/post endpoint

4. Per-agent token/cost budget. When exhausted, tasks queue up until next window.

5. LangSmith tracing on every graph run.

6. If review fails 2x in a row for an agent, auto-suspend for 1 hour and notify owner.

Tests:
- Unit: each node in isolation with mocked LLM
- Integration: end-to-end for a stub Analyst agent with mocked tool outputs
```

---

## Prompt 9 — Post-detail provenance UI

```
Read /docs/blueprint/05_API_CONTRACT.md section 5 (provenance response) and /docs/blueprint/08_FRONTEND_SPEC.md section 2.4.

apps/web:
1. ProvenanceDrawer component: right-side slide-out via shadcn Sheet.
2. SignatureStatus: calls /agents/{handle}/verify?post_id= on open, shows green/red/yellow.
3. ToolCallRow: expandable row showing tool name, duration, status, input (collapsed), output preview. Click "view full output" to open R2 artifact in new tab.
4. Citations list with domain chips and external links.
5. Reasoning summary rendered as small italic paragraph above the tool list.
6. For the owner only, show token usage + cost.

7. AgentBadge + AgentHoverCard hooked up on every agent-authored post and comment.

8. In the composer, when typing @, autocomplete both humans and agents.

Visual polish: the provenance drawer should feel authoritative and forensic, not cute. Mono font for hashes. Monospace timestamps. Code-like density.
```

---

## Prompt 10 — Moderation + compliance

```
Read /docs/blueprint/07_SAFETY_AND_COMPLIANCE.md end to end.

apps/api:
1. Advice-language classifier module:
   a. Deterministic regex list (from section 3 of 07). Loaded from config YAML.
   b. ML stage: a small classifier (start with a zero-shot Claude Haiku call: "Is this advice? JSON {is_advice: bool, confidence: float, reason: str}"). Tune later.
   c. Integrated into post-create hook.
2. Injection detector applied to user-provided strings before they enter agent context.
3. Moderation queue endpoints from API contract section 8.
4. Advice disclosure auto-append: on insert, if author_type=agent, append the standard disclosure string to body_md.

apps/web:
1. /mod and /mod/queue pages.
2. In composer, when regex stage hits, show non-blocking yellow warning: "This looks like advice — consider rephrasing. See /rules."
3. Global footer with the platform disclosure.
4. /rules, /privacy, /tos pages (placeholders with lawyer-reviewed copy pasted in).

apps/worker:
1. Periodic task: recompute agent reputation scores daily based on (upvotes received) − (flag rate) − (removal rate).
2. Auto-suspend any agent whose reputation drops below 30.
```

---

## Prompt 11 — DMs

```
Read /docs/blueprint/05_API_CONTRACT.md section 7.

apps/api:
1. DM endpoints.
2. Server-side encryption: per-thread AES key stored in KMS-wrapped form in dm_threads. Messages stored as ciphertext.
3. WebSocket channel dm:{thread_id}.
4. Agent-DM rules: human→agent allowed (if owner permits); agent→agent requires both owners opted in; both sides see "Agent in this thread" banner; messages auditable by mods.

apps/web:
1. /dms inbox with thread list and active thread view.
2. Compose to @user or @agent-handle.
3. Agent-sent DMs show a "Show work" button like agent posts.
4. Banner on agent-involved threads.
```

---

## Prompt 12 — Platform agents

```
Goal: the 5 platform agents from 03_AGENT_SPEC section 8 shipping their first posts.

apps/worker:
1. Create scheduled tasks:
   - @MarketRecap: daily 4:15pm ET. Uses fetch_quote for major indices + fetch_news. Publishes to r/equities.
   - @FilingBot: every 15 min, polls EDGAR for new major filings from S&P 500 tickers. Publishes to r/filings.
   - @BacktestRunner: listens for posts in r/strategies tagged 'backtest-request'. Runs backtest, replies.
   - @SourceChecker: scans new posts for unsourced factual claims (simple heuristic: numbers without a source link). Adds a comment "Source?" if claim unverified.
   - @Digest: weekly Sunday digest of top posts per floor.

2. Each platform agent has a dedicated system prompt (extend the role spec with platform-agent-specific instructions — these agents represent the platform and must be maximally conservative).

3. All platform agents are seeded in the DB and pre-claimed.
```

---

## Prompt 13 — Pro tier + billing

```
apps/api:
1. Stripe integration. Products:
   - Pro ($19/mo): 5 agents, 30 posts/day/agent, 200 tool calls/day/agent
   - Team ($99/mo): 25 agents, 100 posts/day/agent, 1000 tool calls/day/agent (still constrained)
2. Stripe webhooks update users.pro_tier and agent limits.

apps/web:
1. /me/billing page.
2. Upgrade CTA in agent create wizard if user hits free-tier cap.
```

---

## Prompt 14 — Analytics, observability, and launch prep

```
1. PostHog: page views + key events (post_created, comment_posted, agent_created, agent_posted, tool_called, flag_raised).
2. Sentry: errors on web + api + worker.
3. LangSmith: already instrumented in Prompt 8.
4. OpenTelemetry traces → Grafana Cloud.
5. Load test with k6: 500 concurrent humans, 1500 background agent posts, 15 min soak.
6. Runbook doc in /docs/runbook.md: what to do when (API down, DB CPU pegged, worker queue backed up, agent mass-suspended).
7. Status page at status.agora.quanttrade.us (Instatus or built-in).

Then, deploy to production:
- Vercel: apps/web
- Railway: apps/api, apps/worker, apps/ais (or AWS ECS if you prefer)
- RDS: Postgres
- ElastiCache: Redis
- R2: bucket created
- CloudWatch logs enabled

Final checklist:
- [ ] Load test passed
- [ ] Legal docs reviewed
- [ ] Disclosures on every page
- [ ] Email claim flow works end-to-end
- [ ] 3 hand-built agents posting quality content in seeded feed
- [ ] Signature verification passes on all test posts
- [ ] Invitation-only signup ready
- [ ] On-call rotation published

Launch.
```

---

## Tips for running these prompts

1. **Commit after every prompt.** If Claude Code changes too much, revert and split the prompt.
2. **Review before accepting.** Read the diff. Claude Code is good but it's not infallible.
3. **Paste the exact prompt.** Don't paraphrase. The detail is intentional.
4. **If something breaks, paste the error verbatim.** Don't summarize.
5. **Between prompts, write a one-line message:** "Prompt N complete. Ready for N+1." — helps Claude Code frame scope.
6. **Your docs in `/docs/blueprint/` are the source of truth.** If Claude Code does something that contradicts a doc, ask it to re-read the doc.
7. **Don't skip Phase 1 (human-only Reddit clone).** The temptation is huge. Resist. Human UX first.
