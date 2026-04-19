# QuantTrade Community Platform — Architecture v2

> Principal Architect Review | April 2026
> From monolith to event-driven microservices for a financial community platform

---

## Table of Contents

1. [Architecture Review (Critical)](#1-architecture-review-critical)
2. [Startup-Optimized Architecture (3-Stage)](#2-startup-optimized-architecture)
3. [Microservices Design](#3-microservices-design)
4. [Infrastructure Design (AWS + Cloudflare)](#4-infrastructure-design)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Charting & Visualization Layer](#6-charting--visualization-layer)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Risks & Trade-offs](#8-risks--trade-offs)
9. [Final Recommendation](#9-final-recommendation)

---

## 1. Architecture Review (Critical)

### Current State Assessment

**What exists today:**
- Monolithic FastAPI backend (31 routers, 60+ services, 24 models)
- Monolithic Next.js 16 frontend (39 routes, 90+ components)
- Single EC2 instance with Docker Compose
- Neon PostgreSQL (managed) + ElastiCache Redis
- GitHub Actions CI/CD → GHCR → EC2 SSH deploy
- No IaC, no event streaming, no service mesh

### Issues Identified

#### A. Overengineering (Current)
| Component | Problem | Recommendation |
|-----------|---------|----------------|
| 15+ data providers | Maintenance burden, most are unused fallbacks | Keep 4: yfinance (free), Alpaca (historical), Finnhub (real-time), FMP (fundamentals). Drop robin_stocks (requires user creds), Public.com (requires brokerage acct), TradingView scraping (ToS risk) |
| LangChain + 4 LLM providers | Over-abstracted for current usage | Single Anthropic Claude SDK + one fallback (OpenRouter). Drop LangChain complexity |
| pgvector + Qdrant | Two vector DBs for same purpose | pgvector only until 1M+ embeddings, then evaluate Qdrant |
| Three.js game world | Heavy 3D for a finance platform | Keep but lazy-load entirely; don't block core UX |
| 6 ElevenLabs voices | Niche feature, high cost | Defer until post-revenue |
| Global Monitor (maritime/AIS) | Tangential to core trading community | Phase 2 feature, remove from critical path |

#### B. Missing Components (Critical for Community Platform)
| Missing | Why It Matters | Priority |
|---------|---------------|----------|
| **Community/Forum Service** | Core feature — no posts, threads, or discussions exist | P0 |
| **Feed/Timeline Service** | Users need a personalized activity feed | P0 |
| **Reputation/Trust System** | Financial claims need credibility scoring | P0 |
| **Content Moderation Pipeline** | SEC/FINRA compliance requires AI + human moderation | P0 |
| **Event Bus (Kafka/SQS)** | Services are tightly coupled via direct DB access | P1 |
| **Rate Limiting per User Tier** | Current rate limiting is basic, no tiered access | P1 |
| **Audit Log Service** | Financial platform needs full audit trail | P1 |
| **Search Service (OpenSearch)** | No full-text search for community content | P1 |
| **Notification Service** | Only email exists, no in-app/push notifications | P1 |
| **Media Service** | No image/video upload for community posts | P2 |
| **Analytics/Metrics Pipeline** | No user behavior tracking for feed ranking | P2 |

#### C. Cost Inefficiencies
| Issue | Monthly Cost | Fix |
|-------|-------------|-----|
| Single EC2 running everything | ~$30-50 (t3.small) | Fine for MVP, but no HA |
| 15+ API key subscriptions | $200-500+ | Consolidate to 4 providers |
| Neon PostgreSQL (serverless) | $19-69 | Keep Neon — autoscaling, branching, read replicas. Only evaluate Aurora at 1M+ users |
| No CDN for API responses | N/A | Add Cloudflare Cache Rules for public endpoints |
| ML training in CI (GitHub Actions) | Compute minutes | Move to scheduled EC2 spot instances |

#### D. Security Gaps
| Gap | Risk | Fix |
|-----|------|-----|
| JWT in localStorage | XSS token theft | httpOnly cookies with SameSite=Strict |
| No RBAC | All users have same access | Role-based access (free/pro/mod/admin) |
| API keys in .env on EC2 | Leaked if server compromised | AWS Secrets Manager (already planned) |
| No request signing | API replay attacks | HMAC request signing for sensitive endpoints |
| No content scanning | Malicious uploads | ClamAV + S3 virus scanning |
| SQL injection surface | 31 routers, manual queries exist | SQLAlchemy ORM-only policy, no raw SQL |

#### E. Compliance Risks (SEC/FINRA)
| Risk | Description | Mitigation |
|------|-------------|------------|
| Investment advice liability | AI copilot gives stock recommendations | Every AI response needs "not financial advice" disclaimer + logging |
| Pump-and-dump vectors | Community posts can manipulate tickers | AI manipulation detection on all ticker-related posts |
| Data retention | Financial discussions may be subpoena-eligible | 7-year audit log retention, immutable storage |
| User-generated predictions | "This stock will 10x" posts | Mandatory disclosure: track record display, confidence scoring |
| Options chain display | Showing Greeks without proper disclaimers | Risk acknowledgment flow before options access |

### Approved Changes for v2

1. **Keep**: FastAPI, Next.js, PostgreSQL, Redis, Cloudflare edge, GitHub Actions
2. **Add**: Event bus (SQS/SNS initially), Community services, Moderation pipeline, Audit logging
3. **Remove**: LangChain, robin_stocks, Public.com client, Qdrant, maritime AIS
4. **Migrate**: JWT to httpOnly cookies, .env to Secrets Manager, raw SQL to ORM
5. **Defer**: Three.js game (keep but deprioritize), Global Monitor maritime, ElevenLabs voices

---

## 2. Startup-Optimized Architecture

### Stage 1: MVP (0 → 10K users)

**Timeline**: 8-12 weeks
**Monthly cost**: ~$150-300
**Team**: 1-3 engineers

```
                    Cloudflare (DNS + CDN + WAF)
                              │
                         ┌────┴────┐
                         │  EC2    │  t3.medium ($30/mo)
                         │         │
                    ┌────┴────┬────┴────┐
                    │ Nginx   │         │
                    │ Reverse │         │
                    │ Proxy   │         │
                    ├─────────┤         │
                    │ Next.js │ FastAPI │
                    │  :3000  │  :8000  │
                    └────┬────┴────┬────┘
                         │         │
                    ┌────┴────┐   ┌┴──────┐
                    │  Neon   │   │ Redis │
                    │ Postgres│   │ (local│
                    │ (managed│   │  or   │
                    │  $19/mo)│   │ Elasti│
                    └─────────┘   │ Cache)│
                                  └───────┘
```

**What to build:**
- Auth service (JWT httpOnly cookies, Google OAuth, passkeys — ALREADY DONE)
- Community service (posts, comments, reactions — NEW)
- Feed service (chronological, simple ranking — NEW)
- Basic moderation (keyword filter + Claude API for flagging — NEW)
- Existing: Research, Copilot, Backtesting, Watchlist

**What to skip:**
- Kafka/MSK (use SQS for async jobs)
- OpenSearch (PostgreSQL full-text search is fine to 10K users)
- Kubernetes (single EC2 is fine)
- Microservices (keep monolith, but with clean module boundaries)
- Game world (keep existing but don't expand)
- Real-time presence (just show online count)

**Database strategy:**
- Single Neon PostgreSQL with schemas:
  - `public` — existing tables (users, symbols, prices, etc.)
  - `community` — posts, comments, reactions, threads
  - `moderation` — flags, actions, audit_log
  - `feed` — feed_items, user_feed_cache

**Key trade-off:** Monolith with clean boundaries is 10x faster to ship than microservices. Extract services only when a specific module becomes a bottleneck.

---

### Stage 2: Growth (10K → 1M users)

**Timeline**: Month 6-18
**Monthly cost**: ~$800-2,000
**Team**: 3-8 engineers

```
              Cloudflare (DNS + CDN + WAF + Workers + R2)
                              │
                     ┌────────┴─────────┐
                     │   ALB (AWS)      │
                     │   + API Gateway  │
                     └────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
         │ ECS     │    │ ECS     │    │ ECS     │
         │ Frontend│    │ Core API│    │ Community│
         │ (Next)  │    │ (FastAPI│    │ Service  │
         │ 2 tasks │    │ 3 tasks)│    │ 2 tasks  │
         └─────────┘    └────┬────┘    └────┬────┘
                              │               │
                    ┌─────────┼───────────────┤
                    │         │               │
              ┌─────┴───┐ ┌──┴──────┐ ┌─────┴────┐
              │ Aurora   │ │ Redis   │ │ SQS/SNS  │
              │ Postgres │ │ Cluster │ │ Events   │
              │ (r6g.lg) │ │(r6g.lg) │ │          │
              └──────────┘ └─────────┘ └──────────┘
```

**What changes:**
- **ECS Fargate** replaces single EC2 (auto-scaling, no server management)
- **Extract Community Service** — First microservice extraction (highest write load)
- **Neon PostgreSQL stays** (read replicas available on Pro plan, autoscaling, PR branching already configured)
- **SQS/SNS** for async events (post created → feed update, notification, moderation check)
- **OpenSearch** for community search (posts, users, tickers)
- **Cloudflare R2** for media uploads (images in posts)
- **Cloudflare Workers** for edge caching of public feed data

**Service split:**
| Service | Reason to Extract |
|---------|------------------|
| Community (posts/comments) | Highest write throughput, different scaling needs |
| Moderation | Must be async, can't block post creation |
| Notification | Fan-out pattern, different SLA |
| Everything else | Stays in Core API monolith |

**Database strategy:**
- Neon PostgreSQL Pro (primary + read replica, autoscaling, PR branching)
- Community service gets its own schema (or separate Neon project if write-heavy)
- Redis Cluster mode for session + feed cache
- OpenSearch for full-text search

---

### Stage 3: Scale (1M+ users)

**Timeline**: Month 18+
**Monthly cost**: ~$5,000-15,000
**Team**: 8-20 engineers

```
         Cloudflare (DNS + CDN + WAF + Workers + R2 + Stream)
                              │
                    ┌─────────┴──────────┐
                    │  Global Accelerator │
                    │  + ALB + API GW     │
                    └─────────┬──────────┘
                              │
    ┌─────────┬───────────┬───┴───┬───────────┬──────────┐
    │         │           │       │           │          │
 ┌──┴──┐  ┌──┴──┐   ┌───┴──┐ ┌──┴──┐   ┌───┴──┐  ┌───┴──┐
 │Auth │  │User │   │Comm- │ │Feed │   │Moder-│  │Noti- │
 │Svc  │  │Svc  │   │unity │ │Svc  │   │ation │  │fica- │
 │     │  │     │   │Svc   │ │     │   │Svc   │  │tion  │
 └──┬──┘  └──┬──┘   └──┬───┘ └──┬──┘   └──┬───┘  └──┬───┘
    │        │          │        │          │         │
    └────────┴──────────┴───┬────┴──────────┴─────────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
         ┌────┴────┐  ┌────┴────┐   ┌─────┴────┐
         │ MSK     │  │ Aurora  │   │ Redis    │
         │ (Kafka) │  │ Global  │   │ Global   │
         │ Cluster │  │ DB      │   │ Datastore│
         └─────────┘  └─────────┘   └──────────┘
              │
    ┌─────────┼──────────┐
    │         │          │
 ┌──┴──┐  ┌──┴──┐  ┌───┴──┐
 │Open │  │S3 + │  │Vector│
 │Search│  │R2   │  │DB    │
 │     │  │Media│  │(pgv) │
 └─────┘  └─────┘  └──────┘
```

**What changes:**
- **EKS** replaces ECS (service mesh, better observability, team autonomy)
- **MSK (Kafka)** replaces SQS for high-throughput event streaming
- **Full microservices**: Auth, User, Community, Feed, Moderation, Notification, Search, Media, Market Data, AI/ML
- **Aurora Global Database** for multi-region (migrate from Neon only at this scale)
- **Redis Global Datastore** for session replication
- **Cloudflare Stream** for video content
- **API Gateway** with usage plans per user tier

**ECS vs EKS Decision:**
| Factor | ECS | EKS |
|--------|-----|-----|
| Team size < 5 | Better (simpler) | Overkill |
| Team size 5-10 | Good enough | Consider |
| Team size 10+ | Limiting | Required |
| Service count < 10 | Fine | Overkill |
| Service count 10+ | Possible but painful | Natural fit |
| **Recommendation** | Stage 1-2 | Stage 3 only |

---

## 3. Microservices Design

### Service Catalog

> Note: For MVP (Stage 1), these are **modules within the monolith**, not separate services.
> Extract to microservices only at Stage 2+ when specific scaling needs demand it.

---

### 3.1 Auth Service

**Responsibility:** Authentication, authorization, session management, RBAC

**API Endpoints:**
```
POST   /auth/register          — Email/password registration
POST   /auth/login             — Email/password login → httpOnly cookie
POST   /auth/login/google      — Google OAuth callback
POST   /auth/login/passkey     — WebAuthn assertion
POST   /auth/passkey/register  — Register new passkey
POST   /auth/logout            — Clear session cookie
POST   /auth/refresh           — Refresh access token
POST   /auth/otp/send          — Send OTP to email
POST   /auth/otp/verify        — Verify OTP
GET    /auth/me                — Current user profile + roles
```

**Input/Output Contracts:**
```python
# Register
Input:  { email: str, password: str, display_name: str }
Output: { user_id: uuid, email: str, token: str }  # token in httpOnly cookie

# Login
Input:  { email: str, password: str }
Output: { user_id: uuid, roles: ["user"|"pro"|"moderator"|"admin"] }
        # Set-Cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Strict

# RBAC Check (internal)
Input:  { user_id: uuid, required_role: str }
Output: { allowed: bool }
```

**Database Schema:**
```sql
-- Schema: auth
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255),
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      TEXT,
    role            VARCHAR(20) DEFAULT 'user',  -- user, pro, moderator, admin
    email_verified  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    is_banned       BOOLEAN DEFAULT FALSE,
    ban_reason      TEXT,
    ban_expires_at  TIMESTAMPTZ
);

CREATE TABLE oauth_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    provider    VARCHAR(50) NOT NULL,  -- google, apple
    provider_id VARCHAR(255) NOT NULL,
    UNIQUE(provider, provider_id)
);

CREATE TABLE passkey_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    credential_id   BYTEA UNIQUE NOT NULL,
    public_key      BYTEA NOT NULL,
    sign_count      INTEGER DEFAULT 0,
    device_name     VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) UNIQUE NOT NULL,
    ip_address  INET,
    user_agent  TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**Events Produced:**
- `user.registered` → Notification (welcome email), Feed (create default feed)
- `user.logged_in` → Audit log
- `user.role_changed` → All services (RBAC cache invalidation)
- `user.banned` → Community (hide posts), Feed (remove from feeds)

**Events Consumed:**
- `moderation.user_banned` → Update user ban status

**Dependencies:** PostgreSQL, Redis (session cache)

---

### 3.2 User Service

**Responsibility:** User profiles, preferences, reputation, following/followers

**API Endpoints:**
```
GET    /users/{user_id}              — Public profile
PATCH  /users/me                     — Update own profile
GET    /users/{user_id}/stats        — Post count, reputation, badges
POST   /users/{user_id}/follow       — Follow a user
DELETE /users/{user_id}/follow       — Unfollow
GET    /users/{user_id}/followers    — Follower list (paginated)
GET    /users/{user_id}/following    — Following list (paginated)
GET    /users/me/preferences         — User preferences
PUT    /users/me/preferences         — Update preferences
GET    /users/search?q=              — Search users
```

**Database Schema:**
```sql
CREATE TABLE user_profiles (
    user_id         UUID PRIMARY KEY REFERENCES auth.users(id),
    bio             TEXT,
    location        VARCHAR(100),
    website_url     TEXT,
    twitter_handle  VARCHAR(50),
    trading_style   VARCHAR(50),  -- day_trader, swing, long_term, options
    experience      VARCHAR(20),  -- beginner, intermediate, advanced, expert
    reputation      INTEGER DEFAULT 0,
    post_count      INTEGER DEFAULT 0,
    follower_count  INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0
);

CREATE TABLE user_follows (
    follower_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    following_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE user_badges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    badge_type  VARCHAR(50) NOT NULL,  -- verified_trader, top_analyst, community_mod
    awarded_at  TIMESTAMPTZ DEFAULT NOW(),
    metadata    JSONB DEFAULT '{}'
);

CREATE TABLE user_preferences (
    user_id             UUID PRIMARY KEY REFERENCES auth.users(id),
    theme               VARCHAR(10) DEFAULT 'dark',
    email_notifications BOOLEAN DEFAULT TRUE,
    push_notifications  BOOLEAN DEFAULT TRUE,
    feed_sort           VARCHAR(20) DEFAULT 'hot',  -- hot, new, top
    default_watchlist   UUID,
    timezone            VARCHAR(50) DEFAULT 'America/New_York',
    preferences_json    JSONB DEFAULT '{}'
);
```

**Events Produced:**
- `user.followed` → Feed (add to following feed), Notification
- `user.unfollowed` → Feed (remove from following feed)
- `user.reputation_changed` → Feed ranking weight update

**Events Consumed:**
- `post.created` → Increment post_count
- `reaction.received` → Update reputation
- `moderation.post_removed` → Decrement post_count

**Dependencies:** Auth Service (user verification)

---

### 3.3 Community Service

**Responsibility:** Communities (subreddit-like), membership, roles, settings

**API Endpoints:**
```
POST   /communities                          — Create community
GET    /communities/{slug}                   — Community details
PATCH  /communities/{slug}                   — Update community (owner/mod)
DELETE /communities/{slug}                   — Delete community (owner)
GET    /communities/{slug}/members           — Member list (paginated)
POST   /communities/{slug}/join              — Join community
DELETE /communities/{slug}/leave             — Leave community
GET    /communities/discover                 — Discover communities (trending)
GET    /communities/search?q=               — Search communities
POST   /communities/{slug}/moderators/{uid}  — Add moderator
DELETE /communities/{slug}/moderators/{uid}  — Remove moderator
GET    /communities/{slug}/rules             — Community rules
POST   /communities/{slug}/rules             — Add rule (mod)
```

**Database Schema:**
```sql
CREATE TABLE communities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(100) UNIQUE NOT NULL,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    icon_url        TEXT,
    banner_url      TEXT,
    category        VARCHAR(50),  -- stocks, options, crypto, forex, macro, education
    ticker_focus    VARCHAR(20),  -- optional: community focused on single ticker
    member_count    INTEGER DEFAULT 0,
    post_count      INTEGER DEFAULT 0,
    is_private      BOOLEAN DEFAULT FALSE,
    is_verified     BOOLEAN DEFAULT FALSE,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    settings        JSONB DEFAULT '{}'  -- post_approval_required, etc.
);

CREATE TABLE community_members (
    community_id  UUID REFERENCES communities(id) ON DELETE CASCADE,
    user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role          VARCHAR(20) DEFAULT 'member',  -- member, moderator, owner
    joined_at     TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (community_id, user_id)
);

CREATE TABLE community_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id    UUID REFERENCES communities(id) ON DELETE CASCADE,
    rule_number     INTEGER NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    UNIQUE(community_id, rule_number)
);

CREATE INDEX idx_communities_category ON communities(category);
CREATE INDEX idx_communities_ticker ON communities(ticker_focus) WHERE ticker_focus IS NOT NULL;
```

**Events Produced:**
- `community.created` → Search (index), Feed (create community feed)
- `community.member_joined` → Notification (welcome), Feed (add community to user feed)
- `community.member_left` → Feed (remove community from user feed)

**Events Consumed:**
- `post.created` → Increment post_count
- `moderation.community_quarantined` → Update community status

**Dependencies:** Auth (RBAC), User (profiles)

---

### 3.4 Post Service

**Responsibility:** Creating, reading, updating, deleting posts (the core content unit)

**API Endpoints:**
```
POST   /posts                         — Create post
GET    /posts/{post_id}               — Get single post
PATCH  /posts/{post_id}               — Edit post (author only)
DELETE /posts/{post_id}               — Delete post (author or mod)
GET    /posts/{post_id}/comments      — Get comments tree
GET    /communities/{slug}/posts      — Community posts (paginated)
GET    /users/{user_id}/posts         — User's posts (paginated)
POST   /posts/{post_id}/bookmark      — Bookmark post
DELETE /posts/{post_id}/bookmark      — Remove bookmark
GET    /posts/bookmarks               — User's bookmarked posts
```

**Database Schema:**
```sql
CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID REFERENCES auth.users(id),
    community_id    UUID REFERENCES community.communities(id),
    title           VARCHAR(300) NOT NULL,
    body            TEXT,
    body_html       TEXT,  -- Pre-rendered markdown
    post_type       VARCHAR(20) DEFAULT 'text',  -- text, analysis, trade, poll, media
    
    -- Financial context
    tickers         VARCHAR(20)[] DEFAULT '{}',  -- Referenced tickers [$AAPL, $TSLA]
    sentiment       VARCHAR(10),  -- bullish, bearish, neutral
    position_type   VARCHAR(10),  -- long, short, none
    
    -- Engagement metrics (denormalized for feed performance)
    upvote_count    INTEGER DEFAULT 0,
    downvote_count  INTEGER DEFAULT 0,
    comment_count   INTEGER DEFAULT 0,
    view_count      INTEGER DEFAULT 0,
    share_count     INTEGER DEFAULT 0,
    
    -- Moderation
    is_removed      BOOLEAN DEFAULT FALSE,
    removed_reason  TEXT,
    is_pinned       BOOLEAN DEFAULT FALSE,
    is_locked       BOOLEAN DEFAULT FALSE,
    
    -- AI enrichment
    ai_summary      TEXT,
    ai_fact_score   FLOAT,  -- 0-1 factual accuracy estimate
    ai_risk_flags   JSONB DEFAULT '[]',
    
    -- Media
    media_urls      TEXT[] DEFAULT '{}',
    thumbnail_url   TEXT,
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    -- Full-text search
    search_vector   TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(body, '')), 'B')
    ) STORED
);

CREATE INDEX idx_posts_community ON posts(community_id, created_at DESC);
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_tickers ON posts USING GIN(tickers);
CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);
CREATE INDEX idx_posts_hot ON posts(community_id, (upvote_count - downvote_count) DESC, created_at DESC);

CREATE TABLE post_bookmarks (
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);
```

**Events Produced:**
- `post.created` → Feed (fanout), Moderation (AI check), Search (index), Community (count++), Notification (mentions)
- `post.updated` → Search (re-index), Moderation (re-check if tickers changed)
- `post.deleted` → Feed (remove), Search (de-index), Community (count--)
- `post.vote_changed` → Feed (re-rank), User (reputation update)

**Events Consumed:**
- `moderation.post_flagged` → Update is_removed, removed_reason
- `ai.enrichment_complete` → Update ai_summary, ai_fact_score

**Dependencies:** Auth, Community (membership check), User (author profile)

---

### 3.5 Comment Service

**Responsibility:** Threaded comments on posts, nested replies

**API Endpoints:**
```
POST   /posts/{post_id}/comments              — Create comment
GET    /posts/{post_id}/comments              — Get comment tree (paginated)
PATCH  /comments/{comment_id}                 — Edit comment
DELETE /comments/{comment_id}                 — Delete comment
POST   /comments/{comment_id}/replies         — Reply to comment
```

**Database Schema:**
```sql
CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID REFERENCES community.posts(id) ON DELETE CASCADE,
    author_id       UUID REFERENCES auth.users(id),
    parent_id       UUID REFERENCES comments(id) ON DELETE CASCADE,  -- NULL = top-level
    body            TEXT NOT NULL,
    body_html       TEXT,
    
    -- Threading
    depth           INTEGER DEFAULT 0,  -- Nesting level (max 10)
    path            TEXT NOT NULL,  -- Materialized path: "root_id/parent_id/this_id"
    
    -- Engagement
    upvote_count    INTEGER DEFAULT 0,
    downvote_count  INTEGER DEFAULT 0,
    reply_count     INTEGER DEFAULT 0,
    
    -- Moderation
    is_removed      BOOLEAN DEFAULT FALSE,
    
    -- Financial context
    tickers         VARCHAR(20)[] DEFAULT '{}',
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id, path);
CREATE INDEX idx_comments_parent ON comments(parent_id);
CREATE INDEX idx_comments_author ON comments(author_id);
```

**Events Produced:**
- `comment.created` → Post (comment_count++), Notification (reply/mention), Moderation
- `comment.deleted` → Post (comment_count--)

**Events Consumed:**
- `moderation.comment_flagged` → Update is_removed

**Dependencies:** Auth, Post (existence check)

---

### 3.6 Reaction Service

**Responsibility:** Upvotes, downvotes, emoji reactions on posts and comments

**API Endpoints:**
```
POST   /posts/{post_id}/vote            — Upvote/downvote post
DELETE /posts/{post_id}/vote            — Remove vote
POST   /comments/{comment_id}/vote      — Upvote/downvote comment
DELETE /comments/{comment_id}/vote      — Remove vote
POST   /posts/{post_id}/react           — Emoji reaction (bullish, bearish, rocket, diamond)
GET    /posts/{post_id}/reactions        — Get reaction summary
```

**Database Schema:**
```sql
CREATE TABLE votes (
    user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    target_id     UUID NOT NULL,  -- post_id or comment_id
    target_type   VARCHAR(10) NOT NULL,  -- 'post' or 'comment'
    vote_type     SMALLINT NOT NULL,  -- 1 = upvote, -1 = downvote
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, target_id, target_type)
);

CREATE TABLE reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    target_id   UUID NOT NULL,
    target_type VARCHAR(10) NOT NULL,
    emoji       VARCHAR(20) NOT NULL,  -- bullish, bearish, rocket, diamond_hands, think
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, target_id, target_type, emoji)
);

CREATE INDEX idx_votes_target ON votes(target_id, target_type);
CREATE INDEX idx_reactions_target ON reactions(target_id, target_type);
```

**Events Produced:**
- `reaction.vote_cast` → Post/Comment (update counts), User (reputation), Feed (re-rank)

**Events Consumed:** None (pure producer)

**Dependencies:** Auth (user verification)

---

### 3.7 Feed Service

**Responsibility:** Personalized activity feed, ranking, infinite scroll

**API Endpoints:**
```
GET    /feed                    — User's personalized feed (paginated, cursor-based)
GET    /feed/popular            — Global popular feed
GET    /feed/ticker/{symbol}    — All posts about a ticker
GET    /feed/following          — Posts from followed users
GET    /feed/community/{slug}   — Community-specific feed
```

**Ranking Algorithm (Hot Score):**
```python
def hot_score(upvotes, downvotes, created_at):
    """Reddit-inspired hot ranking with financial weighting"""
    score = upvotes - downvotes
    # Author reputation multiplier (verified traders get 1.5x)
    # Ticker relevance boost (posts about trending tickers rank higher)
    # Time decay (logarithmic, similar to Reddit/HN)
    order = math.log10(max(abs(score), 1))
    sign = 1 if score > 0 else -1 if score < 0 else 0
    seconds = (created_at - epoch).total_seconds() - 1134028003
    return round(sign * order + seconds / 45000, 7)
```

**Database Schema:**
```sql
-- Feed is primarily a Redis-backed system with PostgreSQL fallback

-- Feed cache invalidation tracking
CREATE TABLE feed_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(50) NOT NULL,  -- post_created, vote_changed, etc.
    target_id       UUID NOT NULL,
    community_id    UUID,
    tickers         VARCHAR(20)[] DEFAULT '{}',
    hot_score       FLOAT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feed_events_community ON feed_events(community_id, created_at DESC);
CREATE INDEX idx_feed_events_tickers ON feed_events USING GIN(tickers);
```

**Redis Structure (Primary):**
```
feed:user:{user_id}         — Sorted set of post_ids by hot_score (max 1000)
feed:community:{slug}       — Sorted set of post_ids by hot_score
feed:ticker:{symbol}        — Sorted set of post_ids mentioning ticker
feed:global:hot             — Global hot feed
feed:global:new             — Global new feed (by created_at)
```

**Events Consumed:**
- `post.created` → Fan-out to community feed + follower feeds + ticker feeds
- `reaction.vote_cast` → Re-score post in feeds
- `user.followed` → Rebuild user's following feed
- `community.member_joined` → Add community feed to user's feed

**Dependencies:** Post (content), User (following graph), Community (membership)

---

### 3.8 Moderation Service

**Responsibility:** Content moderation (AI + human), compliance, reporting

**API Endpoints:**
```
POST   /reports                          — Report a post/comment/user
GET    /moderation/queue                 — Mod queue (moderators only)
POST   /moderation/actions/{report_id}   — Take action (approve/remove/warn/ban)
GET    /moderation/audit-log             — Audit trail (admin only)
POST   /moderation/bulk-action           — Bulk moderation (admin)
```

**AI Moderation Pipeline:**
```
Post Created
     │
     ▼
┌─────────────┐
│ Keyword     │ ← Instant (~1ms)
│ Filter      │   Catches obvious spam, slurs, prohibited content
└──────┬──────┘
       │ Pass
       ▼
┌─────────────┐
│ Claude API  │ ← Async (~500ms)
│ Content     │   Financial claim detection, manipulation signals,
│ Analysis    │   pump-and-dump patterns, misleading statements
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Decision    │
│ Engine      │
│             │
│ score < 0.3 → Auto-approve (publish immediately)
│ 0.3 - 0.7  → Queue for human review
│ score > 0.7 → Auto-remove + flag
└─────────────┘
```

**Database Schema:**
```sql
CREATE TABLE moderation_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID REFERENCES auth.users(id),
    target_id       UUID NOT NULL,
    target_type     VARCHAR(20) NOT NULL,  -- post, comment, user
    reason          VARCHAR(50) NOT NULL,  -- spam, misinformation, manipulation, harassment
    description     TEXT,
    status          VARCHAR(20) DEFAULT 'pending',  -- pending, reviewed, resolved
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE moderation_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID REFERENCES moderation_reports(id),
    moderator_id    UUID REFERENCES auth.users(id),
    action_type     VARCHAR(20) NOT NULL,  -- approve, remove, warn, mute, ban
    reason          TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID,  -- NULL for system actions
    actor_type      VARCHAR(20) NOT NULL,  -- user, moderator, admin, system, ai
    action          VARCHAR(50) NOT NULL,
    target_type     VARCHAR(20),
    target_id       UUID,
    metadata        JSONB DEFAULT '{}',
    ip_address      INET,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Immutable audit log: no UPDATE or DELETE allowed (use DB policies)
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id, created_at DESC);
```

**Events Produced:**
- `moderation.post_flagged` → Post (hide), User (warn/ban)
- `moderation.user_banned` → Auth (update status), Community (remove posts)

**Events Consumed:**
- `post.created` → Run AI moderation pipeline
- `comment.created` → Run AI moderation pipeline
- `report.created` → Add to mod queue

**Dependencies:** Auth (RBAC), Claude API (AI analysis)

---

### 3.9 AI Validation Service

**Responsibility:** Fact-checking financial claims, detecting manipulation patterns

**Pipeline:**
```python
class FinancialClaimValidator:
    """
    Detects and validates financial claims in community posts.
    
    Examples of claims to detect:
    - "$AAPL will hit $300 by Q4" → Check current price, analyst targets
    - "Revenue grew 50% YoY" → Cross-reference with SEC filings
    - "Short squeeze incoming, 40% short interest" → Verify SI data
    - "Buy before earnings" → Flag as potential manipulation
    """
    
    async def validate(self, post: Post) -> ValidationResult:
        # 1. Extract financial claims using Claude
        claims = await self.extract_claims(post.body, post.tickers)
        
        # 2. Cross-reference each claim
        for claim in claims:
            if claim.type == "price_target":
                claim.verified = await self.check_price_target(claim)
            elif claim.type == "fundamental":
                claim.verified = await self.check_fundamental(claim)
            elif claim.type == "short_interest":
                claim.verified = await self.check_short_data(claim)
        
        # 3. Calculate overall credibility score
        return ValidationResult(
            claims=claims,
            credibility_score=self.score(claims),
            risk_flags=self.detect_manipulation(post, claims)
        )
```

**Risk Flags:**
- `pump_and_dump`: Small-cap ticker + extreme bullish language + new account
- `misleading_data`: Financial claims that don't match public data
- `coordinated_activity`: Multiple new accounts posting about same ticker
- `undisclosed_position`: Recommendation without position disclosure

---

### 3.10 Notification Service

**Responsibility:** In-app, email, and push notifications

**API Endpoints:**
```
GET    /notifications                  — User's notifications (paginated)
PATCH  /notifications/{id}/read        — Mark as read
POST   /notifications/read-all         — Mark all as read
GET    /notifications/unread-count     — Unread count (for badge)
PUT    /notifications/preferences      — Notification settings
```

**Database Schema:**
```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,
    -- Types: reply, mention, upvote, follow, community_post, price_alert,
    --        moderation_action, badge_earned, system
    title           VARCHAR(200) NOT NULL,
    body            TEXT,
    action_url      TEXT,  -- Deep link
    actor_id        UUID,  -- Who triggered it
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
```

**Events Consumed:**
- `comment.created` → Notify post author ("X replied to your post")
- `reaction.vote_cast` → Notify author (batched: "5 people upvoted your post")
- `user.followed` → Notify followed user
- `moderation.action_taken` → Notify affected user
- `post.mentioned` → Notify mentioned users (@username)

**Notification Batching:**
```
Upvotes within 5 minutes → Batched: "5 people upvoted your post about $AAPL"
Follows within 10 minutes → Batched: "3 new followers"
```

**Dependencies:** Email service (Brevo), future: FCM for push

---

### 3.11 Realtime Gateway (WebSocket)

**Responsibility:** Live data push — presence, typing, live rooms, price ticks

**WebSocket Channels:**
```
ws://api/v1/ws/feed          — Live feed updates (new posts in subscribed communities)
ws://api/v1/ws/thread/{id}   — Live thread updates (new comments, votes)
ws://api/v1/ws/ticker/{sym}  — Live ticker room (chat + price ticks)
ws://api/v1/ws/presence      — Online status broadcasts
ws://api/v1/ws/notifications — Real-time notification delivery
```

**Architecture:**
```
Client ──WebSocket──▶ API Gateway ──▶ WebSocket Gateway (ECS/EKS)
                                              │
                                         Redis Pub/Sub
                                              │
                                    ┌─────────┼─────────┐
                                    │         │         │
                                 Instance  Instance  Instance
                                    1         2         3
```

**Connection Management:**
- Redis Pub/Sub for cross-instance message broadcasting
- Heartbeat: ping every 25s, timeout at 60s
- Auth: JWT token in connection query param → validate on connect
- Max connections per user: 5 (prevent resource exhaustion)
- Backpressure: message queue per connection, drop if > 100 buffered

---

### 3.12 Search Service

**Responsibility:** Full-text search across posts, comments, users, communities

**Implementation Strategy:**

**Stage 1 (MVP):** PostgreSQL `tsvector` + `GIN` indexes
```sql
-- Already defined in posts table (search_vector column)
-- Query:
SELECT * FROM posts
WHERE search_vector @@ plainto_tsquery('english', $1)
ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
LIMIT 20;
```

**Stage 2 (Growth):** OpenSearch
```json
{
  "index": "posts",
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "english" },
      "body": { "type": "text", "analyzer": "english" },
      "tickers": { "type": "keyword" },
      "community_slug": { "type": "keyword" },
      "author_name": { "type": "text" },
      "sentiment": { "type": "keyword" },
      "hot_score": { "type": "float" },
      "created_at": { "type": "date" }
    }
  }
}
```

**API Endpoints:**
```
GET /search?q=&type=posts|comments|users|communities&sort=relevance|recent
GET /search/tickers/{symbol}  — All content mentioning a ticker
GET /search/suggest?q=        — Autocomplete suggestions
```

---

### 3.13 Market Data Service (Existing — Refactored)

**Responsibility:** Stock quotes, historical data, indicators (consolidate existing 15 providers to 4)

**Consolidated Provider Chain:**
```
Quotes:     Finnhub (WebSocket) → yfinance (batch) → FMP (fallback)
Historical: yfinance (free, reliable) → Alpaca (5yr 1-min) → FMP
Intraday:   yfinance (1m/5m) → Alpaca → Finnhub
Fundamentals: FMP → yfinance
News:       Finnhub → NewsAPI → GDELT
```

**This is the existing service, cleaned up. No schema changes needed.**

---

## 4. Infrastructure Design

### AWS Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        VPC (10.0.0.0/16)                    │
│                                                             │
│  ┌──────────────── Public Subnets ─────────────────┐       │
│  │  10.0.1.0/24 (us-east-1a)                       │       │
│  │  10.0.2.0/24 (us-east-1b)                       │       │
│  │                                                   │       │
│  │  ┌─────────┐   ┌─────────────┐                   │       │
│  │  │   NAT   │   │     ALB     │                   │       │
│  │  │ Gateway │   │ (public-facing)                 │       │
│  │  └─────────┘   └──────┬──────┘                   │       │
│  └───────────────────────┼──────────────────────────┘       │
│                          │                                   │
│  ┌──────────────── Private Subnets ────────────────┐       │
│  │  10.0.10.0/24 (us-east-1a)                      │       │
│  │  10.0.11.0/24 (us-east-1b)                      │       │
│  │                                                   │       │
│  │  ┌──── ECS Cluster ────────────────────┐         │       │
│  │  │                                      │         │       │
│  │  │  ┌──────────┐  ┌──────────┐         │         │       │
│  │  │  │ Frontend │  │ Core API │         │         │       │
│  │  │  │ (Next.js)│  │ (FastAPI)│         │         │       │
│  │  │  │ 2 tasks  │  │ 3 tasks  │         │         │       │
│  │  │  └──────────┘  └──────────┘         │         │       │
│  │  │                                      │         │       │
│  │  │  ┌──────────┐  ┌──────────┐         │         │       │
│  │  │  │Community │  │Moderation│         │         │       │
│  │  │  │ Service  │  │ Worker   │         │         │       │
│  │  │  │ 2 tasks  │  │ 1 task   │         │         │       │
│  │  │  └──────────┘  └──────────┘         │         │       │
│  │  └──────────────────────────────────────┘         │       │
│  │                                                   │       │
│  └───────────────────────────────────────────────────┘       │
│                                                             │
│  ┌──────────────── Data Subnets ───────────────────┐       │
│  │  10.0.20.0/24 (us-east-1a)                      │       │
│  │  10.0.21.0/24 (us-east-1b)                      │       │
│  │                                                   │       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │       │
│  │  │ Aurora   │  │ Redis    │  │ SQS      │       │       │
│  │  │ Postgres │  │ Cluster  │  │ Queues   │       │       │
│  │  │ (r6g.lg) │  │(cache.m5)│  │          │       │       │
│  │  └──────────┘  └──────────┘  └──────────┘       │       │
│  │                                                   │       │
│  └───────────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Security Groups

```
SG: alb-sg
  Inbound: 443 from 0.0.0.0/0 (HTTPS only — Cloudflare IPs preferred)

SG: ecs-sg
  Inbound: 8000, 3000 from alb-sg only
  Outbound: All (API calls, DB connections)

SG: db-sg
  Inbound: 5432 from ecs-sg only
  
SG: redis-sg
  Inbound: 6379 from ecs-sg only

SG: sqs-sg
  (VPC endpoints — no inbound rules needed)
```

### IAM Roles

```yaml
# ECS Task Role (per service)
ecs-core-api-role:
  - secretsmanager:GetSecretValue (quanttrade/*)
  - s3:PutObject, s3:GetObject (quanttrade-media/*)
  - sqs:SendMessage, sqs:ReceiveMessage (quanttrade-*)
  - sns:Publish (quanttrade-*)
  - logs:CreateLogStream, logs:PutLogEvents

ecs-moderation-role:
  - secretsmanager:GetSecretValue (quanttrade/anthropic-key)
  - sqs:ReceiveMessage (quanttrade-moderation-queue)
  - sqs:SendMessage (quanttrade-notification-queue)

# CI/CD Role
github-actions-role:
  - ecr:GetAuthorizationToken, ecr:BatchGetImage, ecr:PutImage
  - ecs:UpdateService, ecs:DescribeServices
  - secretsmanager:GetSecretValue (deploy-only secrets)
```

### SQS Queues (Event Bus — Stage 1-2)

```
quanttrade-post-events         — Post CRUD events → Feed, Search, Moderation
quanttrade-moderation-queue    — Content to moderate (async)
quanttrade-notification-queue  — Notification delivery
quanttrade-feed-fanout         — Feed update fanout
quanttrade-audit-log           — Immutable audit events
quanttrade-dlq                 — Dead letter queue (failed messages)
```

### S3 Buckets

```
quanttrade-media-{env}         — User-uploaded images/videos
quanttrade-ml-artifacts        — ML model checkpoints
quanttrade-backups             — Database backups
quanttrade-audit-archive       — Long-term audit log storage (S3 Glacier after 90 days)
```

### Cloudflare Configuration

```yaml
# DNS
quanttrade.us:
  A     → ALB IP (proxied through Cloudflare)
  CNAME api.quanttrade.us → ALB (proxied)
  CNAME ws.quanttrade.us  → ALB (proxied, WebSocket enabled)

# WAF Rules
- Rate Limit: 100 req/min per IP on /api/*
- Rate Limit: 20 req/min per IP on /auth/*
- Block: Known bad bots (except Googlebot, Bingbot)
- Challenge: Requests without valid Turnstile token on /auth/register
- Block: SQL injection patterns in query params
- Block: XSS patterns in request body

# Cache Rules
- /api/v1/market/* → Cache 30s (public market data)
- /api/v1/quotes/* → Cache 5s (real-time quotes)
- /api/v1/news/* → Cache 60s (news articles)
- /_next/static/* → Cache 1 year (immutable assets)
- /api/v1/auth/* → No cache (authenticated endpoints)
- /api/v1/feed/* → No cache (personalized)

# Page Rules
- quanttrade.us/* → SSL Full (Strict)
- api.quanttrade.us/* → SSL Full (Strict), WebSocket ON
- *.quanttrade.us/* → HSTS enabled

# Workers (Edge)
- /api/v1/market/indices → Edge cache with 15s TTL (saves backend calls)
- /api/v1/feed/popular → Edge cache with 60s TTL (global feed)

# Bot Protection
- Managed Challenge for suspicious patterns
- JS Challenge for high-risk countries
- Block Tor exit nodes on /auth/* (financial compliance)

# Zero Trust (Internal)
- /admin/* → Requires Cloudflare Access (team email domain)
- /moderation/* → Requires Cloudflare Access (moderator group)
```

### Terraform Structure (High-Level)

```
infrastructure/
├── modules/
│   ├── vpc/
│   │   ├── main.tf          — VPC, subnets, NAT, route tables
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── ecs/
│   │   ├── cluster.tf       — ECS cluster definition
│   │   ├── services.tf      — Service definitions
│   │   ├── task-definitions/ — Per-service task defs
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── rds/
│   │   ├── main.tf          — Aurora PostgreSQL cluster
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── redis/
│   │   ├── main.tf          — ElastiCache Redis cluster
│   │   └── variables.tf
│   ├── sqs/
│   │   ├── main.tf          — All SQS queues + DLQ
│   │   └── variables.tf
│   ├── s3/
│   │   ├── main.tf          — Buckets + lifecycle policies
│   │   └── variables.tf
│   ├── alb/
│   │   ├── main.tf          — ALB + target groups + listener rules
│   │   └── variables.tf
│   └── secrets/
│       ├── main.tf          — Secrets Manager entries
│       └── variables.tf
├── environments/
│   ├── dev/
│   │   ├── main.tf          — Dev environment (smaller instances)
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf          — Production (HA, multi-AZ)
│       └── terraform.tfvars
├── backend.tf               — S3 + DynamoDB state backend
└── versions.tf              — Provider versions
```

---

## 5. Frontend Architecture

### 5.1 Design System & UI/UX Philosophy

#### Theme System

**Dark Mode (Primary — Terminal/Bloomberg aesthetic):**
```css
:root[data-theme="dark"] {
  --bg-primary: #0a0e17;        /* Deep space black */
  --bg-secondary: #111827;       /* Card surfaces */
  --bg-tertiary: #1a2035;        /* Elevated surfaces */
  --bg-hover: #1e293b;           /* Hover state */
  
  --text-primary: #f1f5f9;       /* High contrast white */
  --text-secondary: #94a3b8;     /* Muted labels */
  --text-tertiary: #64748b;      /* Disabled/hint */
  
  --accent-blue: #3b82f6;        /* Primary actions */
  --accent-cyan: #06b6d4;        /* Data highlights */
  --accent-green: #10b981;       /* Bullish / success */
  --accent-red: #ef4444;         /* Bearish / error */
  --accent-amber: #f59e0b;       /* Warnings */
  
  --border-subtle: rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.12);
  
  --glow-blue: 0 0 20px rgba(59,130,246,0.15);
  --glow-green: 0 0 20px rgba(16,185,129,0.15);
}
```

**Light Mode (Institutional/Bloomberg Terminal white):**
```css
:root[data-theme="light"] {
  --bg-primary: #fafbfc;
  --bg-secondary: #ffffff;
  --bg-tertiary: #f1f5f9;
  --bg-hover: #e2e8f0;
  
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-tertiary: #94a3b8;
  
  --accent-blue: #2563eb;
  --accent-cyan: #0891b2;
  --accent-green: #059669;
  --accent-red: #dc2626;
  --accent-amber: #d97706;
  
  --border-subtle: rgba(0,0,0,0.06);
  --border-strong: rgba(0,0,0,0.12);
}
```

#### Typography Scale
```css
/* Display: Manrope — headings, hero text */
--font-display: 'Manrope', system-ui, sans-serif;

/* Body: Inter — UI text, paragraphs */
--font-body: 'Inter', system-ui, sans-serif;

/* Mono: JetBrains Mono — prices, data, code */
--font-mono: 'JetBrains Mono', 'SF Mono', monospace;

/* Scale */
--text-xs: 0.75rem;    /* 12px — timestamps, badges */
--text-sm: 0.875rem;   /* 14px — body text, labels */
--text-base: 1rem;     /* 16px — default body */
--text-lg: 1.125rem;   /* 18px — section headers */
--text-xl: 1.25rem;    /* 20px — page titles */
--text-2xl: 1.5rem;    /* 24px — hero sections */
--text-3xl: 1.875rem;  /* 30px — landing hero */
```

#### Micro-Interactions

**Upvote Animation:**
```typescript
// Framer Motion variant
const upvoteVariants = {
  idle: { scale: 1, color: 'var(--text-secondary)' },
  pressed: { scale: 0.85, transition: { duration: 0.1 } },
  active: { 
    scale: [1, 1.3, 1], 
    color: 'var(--accent-green)',
    transition: { duration: 0.4, ease: 'easeOut' }
  }
}
// On click: pressed → active, with +1 counter that slides up and fades in
```

**Ticker Modal Open:**
```typescript
// Stock snapshot modal: slide up from bottom on mobile, scale from center on desktop
const modalVariants = {
  hidden: { opacity: 0, y: 50, scale: 0.95 },
  visible: { 
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', damping: 25, stiffness: 300 }
  }
}
```

**Comment Thread Expand:**
```typescript
// Nested comments expand with staggered reveal
const threadVariants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: {
    height: 'auto', opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 }
  }
}
```

#### Remotion Strategy

**Use cases for dynamic video generation:**
1. **Weekly QuantTrade Wrap** — Automated 30s video summarizing top posts, trending tickers, community sentiment
2. **Trade Recap Card** — Shareable 5s animation: ticker + entry/exit + P&L (for Twitter/X sharing)
3. **Portfolio Performance** — 15s animated chart showing user's portfolio vs S&P 500

**Implementation:**
```
/src/remotion/
├── compositions/
│   ├── WeeklyWrap.tsx      — 30s community recap video
│   ├── TradeRecap.tsx      — 5s shareable trade card
│   └── PortfolioReview.tsx — 15s portfolio animation
├── components/
│   ├── AnimatedChart.tsx   — Price chart with drawing animation
│   ├── TickerCard.tsx      — Animated ticker display
│   └── SentimentGauge.tsx  — Bullish/bearish meter
└── Root.tsx                — Remotion composition registry
```

Videos rendered server-side on demand (Lambda or EC2 spot), cached in S3/R2.

---

### 5.2 Performance & DOM Virtualization

#### Feed Virtualization

```typescript
// Use @tanstack/react-virtual for infinite scrolling feeds
import { useVirtualizer } from '@tanstack/react-virtual'

function VirtualFeed({ posts }: { posts: Post[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: posts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // Estimated post height
    overscan: 5, // Render 5 extra items above/below viewport
  })
  
  return (
    <div ref={parentRef} style={{ height: '100vh', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualItem => (
          <PostCard key={virtualItem.key} post={posts[virtualItem.index]} />
        ))}
      </div>
    </div>
  )
}
```

#### Comment Thread Virtualization

For deeply nested threads (Reddit-style), use windowed rendering with collapse:
```typescript
// Flatten nested tree → virtual list
// Each item knows its depth, parent_id, and collapse state
// Only render visible items + 3 above/below
// Collapsed threads show "N more replies" button
```

#### Real-Time Ticker Data

**Canvas-based rendering for live prices:**
- lightweight-charts uses `<canvas>` internally — already optimized
- Price updates: WebSocket → update last candle only (no full redraw)
- Ticker tape (marquee): CSS `transform: translateX()` with `will-change: transform`
- Avoid DOM manipulation for price ticks — use CSS variables or canvas

#### Image/Media Optimization
- `next/image` with AVIF/WebP automatic format
- Lazy loading with Intersection Observer (native `loading="lazy"`)
- Blur placeholder: 10x10 blurred thumbnail inline as base64
- Media in posts: max 4 images, max 2MB each, server-side resize to 1200px width

---

### 5.3 Component Architecture

#### Next.js App Directory Map

```
src/app/
├── (auth)/
│   ├── auth/page.tsx                    — Login/Register (existing)
│   └── auth/forgot-password/page.tsx    — Password reset (existing)
│
├── (main)/                              — Layout with sidebar + header
│   ├── layout.tsx                       — Main app layout
│   ├── page.tsx                         — Home / global feed
│   │
│   ├── feed/
│   │   ├── page.tsx                     — Personalized feed (NEW)
│   │   └── [community]/page.tsx         — Community feed (NEW)
│   │
│   ├── post/
│   │   └── [id]/page.tsx               — Single post + thread (NEW)
│   │
│   ├── community/
│   │   ├── page.tsx                     — Discover communities (NEW)
│   │   ├── create/page.tsx             — Create community (NEW)
│   │   └── [slug]/
│   │       ├── page.tsx                — Community page (NEW)
│   │       └── settings/page.tsx       — Community settings (NEW)
│   │
│   ├── user/
│   │   └── [username]/page.tsx         — User profile (NEW)
│   │
│   ├── ticker/
│   │   └── [symbol]/page.tsx           — Ticker page with posts + chart (NEW)
│   │
│   ├── research/page.tsx               — Stock research (existing)
│   ├── copilot/page.tsx                — AI copilot (existing)
│   ├── backtest/page.tsx               — Backtesting (existing)
│   ├── watchlist/page.tsx              — Watchlist (existing)
│   ├── ideas-lab/page.tsx              — Ideas lab (existing)
│   ├── monitor/page.tsx                — Global monitor (existing)
│   ├── markets/page.tsx                — Markets (existing)
│   │
│   ├── notifications/page.tsx          — Notification center (NEW)
│   ├── settings/page.tsx               — Settings (existing)
│   └── moderation/page.tsx             — Mod dashboard (NEW, role-gated)
│
├── api/                                — Next.js API routes (if needed)
└── layout.tsx                          — Root layout (fonts, theme, providers)
```

#### Component Hierarchy

```
<RootLayout>                            — Fonts, ThemeProvider, QueryProvider
  <AuthProvider>                        — JWT session, user context
    <WebSocketProvider>                 — WS connection manager
      <AppLayout>                       — Sidebar + Header + Content
        <Sidebar />                     — Navigation links
        <Header />                      — Search, notifications, profile
        <main>
          {/* Route content */}
          
          {/* Feed Page */}
          <FeedPage>
            <FeedFilters />             — Hot / New / Top / Following
            <VirtualFeed>               — Virtualized post list
              <PostCard />              — Individual post preview
                <PostHeader />          — Author, community, timestamp
                <PostBody />            — Content, media, tickers
                <PostFooter />          — Votes, comments, share, bookmark
                <TickerChips />         — Referenced ticker badges
            </VirtualFeed>
            <FeedSidebar />             — Trending tickers, communities
          </FeedPage>
          
          {/* Post Thread Page */}
          <ThreadPage>
            <PostFull />                — Full post content
            <CommentComposer />         — Write a comment
            <CommentTree>               — Threaded comments
              <CommentNode />           — Recursive comment component
                <CommentHeader />       — Author, time, depth indicator
                <CommentBody />         — Content
                <CommentActions />      — Vote, reply, report
                <CommentReplies />      — Nested children (collapsible)
            </CommentTree>
          </ThreadPage>
          
          {/* Ticker Page (NEW) */}
          <TickerPage>
            <TickerHeader />            — Price, change, key stats
            <RealtimeCandlestickChart />— TradingView wrapper
            <TickerTabs>
              <CommunityPosts />        — Posts mentioning this ticker
              <Fundamentals />          — Company data
              <OptionChain />           — Options (existing)
              <News />                  — Ticker news
              <Indicators />            — Technical analysis
            </TickerTabs>
          </TickerPage>
          
        </main>
        <ChatWidget />                  — Floating AI copilot
      </AppLayout>
    </WebSocketProvider>
  </AuthProvider>
</RootLayout>
```

---

### 5.4 State Management & Data Flow

#### Zustand Stores

```typescript
// Global UI State
interface AppStore {
  // Theme
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  
  // Auth
  user: User | null
  setUser: (user: User | null) => void
  
  // Active states
  selectedSymbol: string | null
  setSelectedSymbol: (symbol: string | null) => void
  activeTickerModal: string | null
  setActiveTickerModal: (symbol: string | null) => void
  
  // WebSocket
  wsStatus: 'connected' | 'connecting' | 'disconnected'
  setWsStatus: (status: WsStatus) => void
  
  // Feed
  feedSort: 'hot' | 'new' | 'top'
  setFeedSort: (sort: FeedSort) => void
  
  // Notifications
  unreadCount: number
  setUnreadCount: (count: number) => void
  
  // Crosshair sync (charts)
  syncedTimestamp: number | null
  setSyncedTimestamp: (ts: number | null) => void
}
```

#### React Query Strategy

```typescript
// Query key conventions
const queryKeys = {
  feed: (sort: string, community?: string) => ['feed', sort, community],
  post: (id: string) => ['post', id],
  comments: (postId: string) => ['comments', postId],
  quote: (symbol: string) => ['quote', symbol],
  user: (id: string) => ['user', id],
  notifications: () => ['notifications'],
  communities: () => ['communities'],
}

// Cache invalidation strategy
// Post created → invalidate feed queries
// Vote cast → optimistic update on post, invalidate after confirm
// Comment added → optimistic append, invalidate thread
// Follow/unfollow → invalidate following feed
```

#### Optimistic UI Contract

```typescript
// Example: Upvoting a post
async function handleUpvote(postId: string) {
  // 1. Optimistic update (instant UI feedback)
  queryClient.setQueryData(['post', postId], (old: Post) => ({
    ...old,
    upvote_count: old.upvote_count + 1,
    user_vote: 1
  }))
  
  // 2. Trigger animation
  controls.start('active')
  
  // 3. Fire-and-forget API call
  try {
    await api.post(`/posts/${postId}/vote`, { vote_type: 1 })
  } catch {
    // 4. Rollback on failure
    queryClient.setQueryData(['post', postId], (old: Post) => ({
      ...old,
      upvote_count: old.upvote_count - 1,
      user_vote: 0
    }))
    toast.error('Vote failed')
  }
}
```

---

## 6. Charting & Visualization Layer

### 6.1 TradingView Wrapper — `<RealtimeCandlestickChart />`

**Design requirements:**
- Handle React strict mode (double mount/unmount)
- Theme reactivity without full unmount
- Live WebSocket candle updates (update last bar only)
- Memory-safe cleanup on route change

```typescript
// Architecture (not full code — skeleton for implementation)

interface RealtimeCandlestickChartProps {
  symbol: string
  data: CandleData[]
  seriesType?: 'candlestick' | 'line' | 'area' | 'heikin-ashi' | 'baseline'
  showVolume?: boolean
  showMA?: boolean
  logScale?: boolean
  showGrid?: boolean
  onCrosshairMove?: (timestamp: number | null) => void
}

// Key implementation details:
// 1. useRef for chart instance — never store in state
// 2. Separate useEffect for chart creation vs data updates
// 3. Theme changes: chart.applyOptions() — no remount needed
// 4. WebSocket updates: candlestickSeries.update(lastBar) — single bar update
// 5. Cleanup: chart.remove() in useEffect cleanup, null all refs
```

**Theme Reactivity (no remount):**
```typescript
useEffect(() => {
  if (!chartRef.current) return
  const isDark = theme === 'dark'
  chartRef.current.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: isDark ? '#0a0e17' : '#fafbfc' },
      textColor: isDark ? '#94a3b8' : '#475569',
    },
    grid: {
      vertLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
      horzLines: { color: isDark ? '#1e293b' : '#e2e8f0' },
    },
  })
}, [theme])
```

**Live WebSocket Update:**
```typescript
useEffect(() => {
  if (!wsLastTick || !seriesRef.current) return
  // Update only the last candle — O(1) operation, no redraw
  seriesRef.current.update({
    time: wsLastTick.time as Time,
    open: wsLastTick.open,
    high: wsLastTick.high,
    low: wsLastTick.low,
    close: wsLastTick.close,
  })
}, [wsLastTick])
```

### 6.2 Sentiment Heatmap — `<SentimentHeatmap />`

**Concept:** Area chart showing bullish vs bearish community sentiment overlaid on price timeline.

**Implementation with Visx:**
```typescript
// Data structure
interface SentimentPoint {
  timestamp: number
  bullish_mentions: number
  bearish_mentions: number
  net_sentiment: number // bullish - bearish, normalized to [-1, 1]
}

// Visx components used:
// - AreaClosed for sentiment fill
// - LinePath for sentiment line
// - Threshold for bullish (green) vs bearish (red) fill
// - useTooltip + TooltipWithBounds for hover info
// - scaleTime + scaleLinear for axes

// Key: Use Threshold component to show green above 0 and red below 0
// Animation: Framer Motion for initial reveal (clipPath animation)
```

### 6.3 Cross-Chart Synchronization

**Zustand store for crosshair sync:**
```typescript
interface ChartSyncStore {
  syncedTimestamp: number | null
  setSyncedTimestamp: (ts: number | null) => void
  hoveredChart: string | null
  setHoveredChart: (id: string | null) => void
}

// In each chart component:
// 1. On crosshairMove → if this chart is hovered, broadcast timestamp to store
// 2. On store timestamp change → if NOT hovered, move crosshair to timestamp
// This prevents feedback loops: only the hovered chart writes, others read
```

### 6.4 Memory Management Guidelines

```typescript
// MANDATORY cleanup pattern for ALL chart components:

useEffect(() => {
  const chart = createChart(container, options)
  chartRef.current = chart
  
  const series = chart.addCandlestickSeries(seriesOptions)
  seriesRef.current = series
  
  const resizeObserver = new ResizeObserver(entries => {
    chart.applyOptions({ width: entries[0].contentRect.width })
  })
  resizeObserver.observe(container)
  
  return () => {
    // 1. Disconnect observers
    resizeObserver.disconnect()
    
    // 2. Remove chart (destroys canvas + internal state)
    chart.remove()
    
    // 3. Null all refs (allow GC)
    chartRef.current = null
    seriesRef.current = null
    overlayRefs.current = []
    
    // 4. Close WebSocket subscriptions (handled by WS provider)
  }
}, []) // Empty deps — chart created once, data updates separately
```

**Rules:**
1. Never store chart instances in React state (triggers re-renders)
2. Never create charts in render — only in useEffect
3. Always null refs in cleanup (prevents stale ref access)
4. Use separate useEffect for data updates (prevents chart recreation)
5. ResizeObserver > window.addEventListener('resize') (per-element, auto-cleanup)

---

## 7. Implementation Roadmap

### Phase 0: Foundation (Week 1-2)

**Goal:** Clean up existing codebase, establish community service foundation

```
Step 1: Repository restructuring
├── Move JWT to httpOnly cookies (security fix)
├── Add RBAC middleware (role checking on routes)
├── Create community schema in PostgreSQL
├── Set up SQS queues (3 initial: post-events, moderation, notification)
└── Create Terraform skeleton for IaC migration

Step 2: Database migrations
├── Add community tables (communities, members, rules)
├── Add post tables (posts, comments, votes, reactions)
├── Add moderation tables (reports, actions, audit_log)
├── Add notification table
└── Add feed_events table

Step 3: Backend foundation
├── Create community router (/api/v1/communities/*)
├── Create post router (/api/v1/posts/*)
├── Create comment router (/api/v1/posts/{id}/comments/*)
├── Create reaction router (/api/v1/posts/{id}/vote, /react)
├── Create notification router (/api/v1/notifications/*)
└── Wire up SQS event publishing
```

### Phase 1: Core Community (Week 3-5)

**Goal:** Users can create communities, post, comment, vote

```
Step 4: Community CRUD
├── POST /communities (create)
├── GET /communities/{slug} (read)
├── POST /communities/{slug}/join
├── GET /communities/discover (trending by member_count)
└── Community settings page (frontend)

Step 5: Posts & Comments
├── Post creation with markdown editor
├── Ticker mention detection ($AAPL → link to ticker page)
├── Comment threading (recursive component)
├── Upvote/downvote with optimistic UI
├── Bookmark posts
└── Post type selection (text, analysis, trade idea)

Step 6: Feed
├── Chronological feed (simple, no ranking yet)
├── Community feed (posts in joined communities)
├── Ticker feed (posts mentioning a symbol)
├── Infinite scroll with cursor-based pagination
└── Feed filters: Hot / New / Top
```

### Phase 2: Trust & Moderation (Week 6-8)

**Goal:** AI moderation pipeline, reporting, mod tools

```
Step 7: AI Moderation
├── Keyword filter (instant, regex-based)
├── Claude API content analysis (async via SQS)
├── Financial claim detection
├── Auto-approve / queue / auto-remove pipeline
└── Moderation action logging (immutable audit)

Step 8: Reporting & Mod Dashboard
├── Report post/comment/user flow
├── Mod queue page (pending reports)
├── Mod actions (approve, remove, warn, ban)
├── User reputation display (post history, badges)
└── Community-level mod roles

Step 9: Compliance Features
├── "Not financial advice" disclaimer on AI responses
├── Position disclosure prompt on trade posts
├── Manipulation pattern detection (coordinated posting)
├── 7-year audit log retention policy
└── SEC/FINRA risk flag system
```

### Phase 3: Real-Time & Social (Week 9-11)

**Goal:** Live updates, notifications, following, presence

```
Step 10: WebSocket Integration
├── Live feed updates (new post appears without refresh)
├── Live comment updates in thread view
├── Typing indicator in comment composer
├── Online presence (community member count)
└── Price tick integration in ticker rooms

Step 11: Notifications
├── In-app notification center
├── Real-time notification delivery (WebSocket)
├── Email notification digest (daily/weekly)
├── Notification preferences
├── Batching (5 upvotes → 1 notification)
└── Unread badge in header

Step 12: Social Graph
├── Follow/unfollow users
├── Following feed tab
├── User profile page (posts, stats, badges)
├── Mention system (@username in posts/comments)
└── Follower/following lists
```

### Phase 4: Discovery & Polish (Week 12-14)

**Goal:** Search, recommendations, ticker pages, UX polish

```
Step 13: Search
├── Full-text search (PostgreSQL tsvector initially)
├── Search results page (posts, users, communities)
├── Autocomplete suggestions
├── Ticker-specific search
└── Search filters (time, community, type)

Step 14: Ticker Community Page
├── /ticker/[symbol] page combining:
│   ├── Price chart (existing TradingView wrapper)
│   ├── Community posts mentioning ticker
│   ├── Key stats (existing fundamentals)
│   ├── News feed (existing)
│   └── Sentiment gauge (new)
└── Ticker-focused communities (auto-link)

Step 15: UX Polish
├── Framer Motion page transitions
├── Post creation flow (rich markdown editor)
├── Image upload for posts (S3/R2)
├── Dark/Light theme polish
├── Mobile responsive community pages
└── Loading skeletons for all new pages
```

### Phase 5: Scale Prep (Week 15-18)

**Goal:** Infrastructure hardening, ECS migration, monitoring

```
Step 16: ECS Migration
├── Write Terraform modules (VPC, ECS, ALB, RDS)
├── Move from EC2 Docker Compose → ECS Fargate
├── Set up ALB with path-based routing
├── Configure auto-scaling policies
└── Blue/green deployment strategy

Step 17: Monitoring & Observability
├── CloudWatch metrics + alarms
├── Structured logging (JSON format)
├── Request tracing (X-Ray or OpenTelemetry)
├── Error tracking (Sentry)
└── Performance dashboards

Step 18: Community Extract (if needed)
├── Extract Community Service to separate ECS task
├── Separate database schema
├── SQS-based communication
├── Independent scaling
└── Circuit breaker for inter-service calls
```

### Deployment Strategy (CI/CD)

```yaml
# Updated GitHub Actions pipeline
name: Deploy
on:
  push:
    branches: [main]

jobs:
  test:
    - Backend tests (pytest)
    - Frontend tests (vitest)
    - TypeScript type check
    - Linting
  
  build:
    needs: test
    - Build Docker images
    - Push to ECR (replace GHCR)
    - Tag with commit SHA
  
  deploy-staging:
    needs: build
    - Deploy to ECS staging
    - Run smoke tests
    - Run integration tests
  
  deploy-prod:
    needs: deploy-staging
    - Blue/green deploy to ECS prod
    - Health check (5 min)
    - Auto-rollback on failure
```

---

## 8. Risks & Trade-offs

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Monolith → microservice too early | Wasted dev time, operational overhead | Stay monolith until 100K+ users, then extract only bottleneck services |
| Feed ranking quality | Poor feed = users leave | Start simple (hot score), iterate with ML later |
| AI moderation false positives | Legitimate posts removed, user frustration | Low threshold for auto-remove (score > 0.8 only), human review for middle range |
| WebSocket scaling | Connection limits per server | Redis pub/sub for cross-instance broadcast, connection pooling |
| PostgreSQL full-text search limits | Slow at 1M+ posts | Migrate to OpenSearch at Stage 2, PostgreSQL is fine until then |
| Comment tree depth | Deep threads crash DOM | Cap depth at 10, virtualize rendering, collapse by default at depth > 3 |

### Business Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| SEC/FINRA regulatory action | Platform shutdown | Mandatory disclaimers, audit logging, proactive compliance review |
| Pump-and-dump liability | Legal action, reputation damage | AI manipulation detection, suspicious pattern alerts to compliance team |
| User-generated investment advice | Liability exposure | Terms of service, mandatory "not financial advice" on all trade posts |
| Content moderation quality | Toxic community drives users away | Invest in moderation early, community guidelines, reputation system |

### Cost Trade-offs

| Decision | Cost | Alternative | Why This Choice |
|----------|------|-------------|-----------------|
| Neon → Aurora migration | +$200/mo | Stay on Neon | HA + read replicas at scale |
| SQS vs Kafka | $10/mo (SQS) vs $300/mo (MSK) | Start SQS | MSK only at 1M+ events/day |
| ECS Fargate vs EC2 | +$100-200/mo | Stay on EC2 | Auto-scaling, no server management |
| Cloudflare Pro plan | $25/mo | Free plan | WAF rules, bot protection, analytics |

---

## 9. Final Recommendation

### For MVP (Now → 3 months)

1. **Stay monolith** — Clean module boundaries, but single FastAPI deployment
2. **Build community features first** — Posts, comments, votes, basic feed. This is the core product.
3. **AI moderation from day 1** — Financial platform needs compliance. Don't bolt it on later.
4. **Keep existing infra** — EC2 + Docker Compose is fine for 10K users. Don't over-invest in infra before product-market fit.
5. **httpOnly cookies** — Fix JWT security immediately. This is a financial platform.
6. **Consolidate data providers** — 4 providers (yfinance, Alpaca, Finnhub, FMP), not 15.

### For Growth (3-12 months)

1. **ECS Fargate migration** — Auto-scaling without server management
2. **Extract Community Service** — First microservice, highest write load
3. **SQS event bus** — Decouple services without Kafka complexity
4. **OpenSearch** — Full-text search across posts, users, communities
5. **Aurora PostgreSQL** — HA with read replicas
6. **Cloudflare Workers** — Edge cache for public feeds and market data

### For Scale (12+ months)

1. **EKS** — Only when team size demands independent service deployment
2. **MSK (Kafka)** — Only when SQS throughput becomes a bottleneck (>1M events/day)
3. **ML-based feed ranking** — Replace hot score with personalized recommendations
4. **Multi-region** — Aurora Global Database + Redis Global Datastore
5. **Remotion video pipeline** — Shareable community content generation

### Critical Path

```
Week 1-2:  Foundation (auth fix, DB schemas, SQS setup)
Week 3-5:  Core Community (posts, comments, votes, feed)
Week 6-8:  Trust Layer (AI moderation, reporting, compliance)
Week 9-11: Real-Time (WebSocket, notifications, social)
Week 12-14: Discovery (search, ticker pages, UX polish)
Week 15+:  Scale (ECS, monitoring, service extraction)
```

**The single most important thing:** Ship the community features fast. Everything else (infra, scaling, fancy charts) is secondary to proving that financial community engagement works on QuantTrade.

---

*Architecture v2 — Approved*
*QuantTrade Principal Architect Review, April 2026*
