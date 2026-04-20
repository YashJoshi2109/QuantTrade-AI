# QuantTrade Community Platform — Execution Plan

> Version 1.0 | April 2026
> Finance-native community platform: Reddit meets Bloomberg Terminal

---

## Table of Contents

1. [Immediate Next Milestone](#a-immediate-next-milestone)
2. [Week-by-Week Execution Plan](#b-week-by-week-execution-plan)
3. [Core Features to Complete](#c-core-features-to-complete)
4. [Reddit & External Data Integration](#d-reddit--external-data-integration)
5. [ML Sentiment Model](#e-ml-sentiment-model)
6. [Seed Content Strategy](#f-seed-content-strategy)
7. [Launch Readiness Checklist](#g-launch-readiness-checklist)
8. [Trust & Compliance Layer](#h-trust--compliance-layer)
9. [What Not to Build Yet](#i-what-not-to-build-yet)
10. [Final Sprint Recommendation](#j-final-sprint-recommendation)

---

## Current State Assessment

### What's Built (Foundation Complete)

| Layer | Status | Details |
|-------|--------|---------|
| **Backend API** | 24 endpoints | Communities, Posts, Comments, Votes, Feed, Notifications, Users, Moderation |
| **Frontend Pages** | 5 pages | Feed, Post Detail, Discover, Moderation, Notifications |
| **Frontend Components** | 10 components | PostCard, CommentTree, CommunitySidebar, TrendingSidebar, Skeletons, etc. |
| **Database** | 11 tables | communities, posts, comments, votes, reactions, notifications, follows, moderation_reports, moderation_actions, audit_log, community_members |
| **AI Moderation** | 3-stage pipeline | Regex filter → Claude analysis → Decision engine (auto-approve/review/remove) |
| **Reputation** | Point system | 9 action types, calculate + update functions |
| **Auth** | Production-ready | httpOnly cookies, JWT, Google OAuth, WebAuthn passkeys, RBAC |
| **Infra** | Deployed | EC2 + Docker, Neon PostgreSQL, Redis, GitHub Actions CI/CD |

### Reddit-Like Completion: ~60%

**Built:** Core CRUD, voting, threading, feeds, moderation, reputation
**Missing:** Search, bookmarks, flairs, image upload, comment sorting, trending tickers (live), Reddit data ingestion, sentiment scoring, WebSocket notifications, automod, bans, user profile editing

---

## A. Immediate Next Milestone

### "Living Feed" — Real Content + Live Trending

**The #1 problem:** The feed is empty. An empty community is a dead community. No user will return to a ghost town.

**The milestone:** Seed 800+ real financial posts from Reddit + wire live trending tickers. When a user lands on `/community`, they see active discussions about $NVDA, $AAPL, $TSLA with real vote counts, real comments, and a live trending ticker sidebar.

**This accomplishes three things:**
1. Product looks alive on day 1
2. Validates the full post/community/feed stack end-to-end
3. Provides training data for the ML sentiment model in weeks 4-5

**Definition of done:**
- 8 communities seeded with real metadata
- 800+ posts imported from 8 financial subreddits
- TrendingSidebar shows live ticker mentions with real prices
- Sentiment scored on all imported posts
- Zero placeholder/mock data anywhere

---

## B. Week-by-Week Execution Plan

### Week 1: Seed Content Pipeline + Community CRUD Completion

| Task | Type | Priority | Est. Hours |
|------|------|----------|------------|
| Reddit ingestion service (`asyncpraw`) | Backend | P0 | 12 |
| Auto-create 8 seed communities | Backend | P0 | 2 |
| Trending tickers endpoint (live) | Backend | P0 | 4 |
| Community edit/delete endpoints | Backend | P0 | 4 |
| Community rules (in settings JSON) | Backend | P1 | 3 |
| Wire TrendingSidebar to live API | Frontend | P0 | 3 |
| Community edit/delete UI | Frontend | P1 | 4 |
| Integration tests (Reddit mock) | Test | P0 | 4 |
| **Browser automation QA** | Test | P0 | 3 |

**Ships:** Feed with 800 real posts, live trending tickers, community management

---

### Week 2: Posts Enhancement + Bookmarks + User Profiles

| Task | Type | Priority | Est. Hours |
|------|------|----------|------------|
| Bookmark model + endpoints | Backend | P1 | 4 |
| Post pin/lock endpoints | Backend | P1 | 3 |
| User profile edit endpoint | Backend | P1 | 3 |
| User comment history endpoint | Backend | P1 | 3 |
| Image upload (S3/R2) | Backend | P1 | 6 |
| Post model: source_url, source_platform, flair | Backend | P0 | 2 |
| Bookmark button on PostCard | Frontend | P1 | 2 |
| Image attach in create post modal | Frontend | P1 | 4 |
| User profile edit page | Frontend | P1 | 4 |
| Comment history tab on profile | Frontend | P1 | 3 |
| Pin/lock indicators on posts | Frontend | P1 | 2 |
| **Browser automation QA** | Test | P0 | 3 |

**Ships:** Bookmarks, image posts, editable profiles, pinned posts

---

### Week 3: Smart Feeds + WebSocket + @Mentions

| Task | Type | Priority | Est. Hours |
|------|------|----------|------------|
| Comment sorting (best/top/new/controversial) | Backend | P1 | 6 |
| Wilson score calculation | Backend | P1 | 2 |
| Feed sort params (hot/new/top/rising) | Backend | P1 | 4 |
| Time-window filtering (day/week/month/year) | Backend | P1 | 3 |
| @mention detection + notifications | Backend | P1 | 4 |
| WebSocket community channels | Backend | P1 | 6 |
| Comment sort dropdown | Frontend | P1 | 3 |
| Feed sort + time controls | Frontend | P1 | 3 |
| WebSocket notification bell | Frontend | P1 | 4 |
| @mention autocomplete | Frontend | P2 | 4 |
| **Browser automation QA** | Test | P0 | 3 |

**Ships:** Smart comment ranking, real-time notifications, rising feed, @mentions

---

### Week 4: ML Sentiment + News Auto-Posting

| Task | Type | Priority | Est. Hours |
|------|------|----------|------------|
| FinBERT sentiment service | Backend/ML | P0 | 8 |
| Post sentiment auto-scoring (background task) | Backend | P0 | 4 |
| Backfill sentiment on existing posts | Backend | P0 | 3 |
| News auto-posting (Celery task) | Backend | P0 | 6 |
| Market mood aggregate endpoint | Backend | P1 | 4 |
| Daily market wrap auto-post | Backend | P1 | 4 |
| Sentiment badge on PostCard | Frontend | P0 | 2 |
| Market Mood gauge widget | Frontend | P1 | 4 |
| News post card variant | Frontend | P1 | 3 |
| **ML model tests + Browser QA** | Test | P0 | 4 |

**Ships:** Every post has sentiment, news flows automatically, market mood widget

---

### Week 5: Moderation Scale + Trust + Flairs

| Task | Type | Priority | Est. Hours |
|------|------|----------|------------|
| AutoMod rules engine | Backend | P1 | 8 |
| AutoMod API (CRUD per community) | Backend | P1 | 4 |
| Ban system (temp/permanent) | Backend | P1 | 6 |
| Financial disclaimer auto-injection | Backend | P0 | 2 |
| User verification tiers | Backend | P1 | 4 |
| Position disclosure prompts | Backend | P2 | 3 |
| Post + user flairs | Backend | P2 | 4 |
| Reputation-based badges (computed) | Backend | P1 | 3 |
| AutoMod rules editor UI | Frontend | P1 | 5 |
| Ban management UI | Frontend | P1 | 4 |
| Flair selector + display | Frontend | P2 | 3 |
| Badge display on user cards | Frontend | P1 | 2 |
| **Browser automation QA** | Test | P0 | 3 |

**Ships:** Scalable moderation, compliance layer, community identity

---

### Week 6: Search + Polish + Documentation

| Task | Type | Priority | Est. Hours |
|------|------|----------|------------|
| Full-text search (PostgreSQL tsvector) | Backend | P1 | 6 |
| Unified search endpoint | Backend | P1 | 4 |
| Notification preferences | Backend | P2 | 3 |
| Performance: Redis caching on feeds | Backend | P1 | 4 |
| Comment tree CTE optimization | Backend | P2 | 3 |
| Search results page | Frontend | P1 | 6 |
| Notification preferences UI | Frontend | P2 | 3 |
| Architecture documentation | Docs | P0 | 6 |
| Architecture diagrams (draw.io) | Docs | P0 | 4 |
| API documentation cleanup | Docs | P1 | 3 |
| End-to-end integration test | Test | P0 | 4 |
| **Full browser automation QA** | Test | P0 | 4 |

**Ships:** Full-text search, polished UX, production-ready documentation

---

## C. Core Features to Complete

### 1. Community CRUD (Completion)

**Why:** Owners can't edit their community name, description, or rules. Broken for any real community management.

| Aspect | Details |
|--------|---------|
| **Backend** | `PATCH /communities/{slug}` (owner/admin), `DELETE /communities/{slug}` (soft-delete), `GET/PUT /communities/{slug}/rules` (store in `settings` JSON) |
| **Frontend** | Edit modal on community page, delete confirmation dialog, rules editor |
| **Dependencies** | None — pure CRUD on existing models |
| **Launch Priority** | P0 — Week 1 |

---

### 2. Posts Enhancement

**Why:** Posts are text-only. No images, no pins, no bookmarks. Users expect media-rich posts.

| Aspect | Details |
|--------|---------|
| **Backend** | Image upload endpoint (S3/R2), pin/lock toggle endpoints, bookmark model + CRUD, `source_url`/`source_platform`/`flair` columns on Post |
| **Frontend** | Image attach in post modal, pinned post indicator, bookmark button with optimistic UI, flair tag display |
| **Dependencies** | S3 or Cloudflare R2 bucket for image storage |
| **Launch Priority** | P1 — Week 2 |

---

### 3. Comment Sorting

**Why:** Chronological-only comments bury the best responses. Reddit's "Best" sort (Wilson score) surfaces quality.

| Aspect | Details |
|--------|---------|
| **Backend** | Add `sort` param to `GET /posts/{post_id}/comments`: `best` (Wilson score interval), `top` (net votes), `new` (created_at), `controversial` (high total votes, near 50/50 split) |
| **Frontend** | Sort dropdown on post detail page, preserve sort in URL params |
| **Dependencies** | None |
| **Launch Priority** | P1 — Week 3 |

**Wilson Score Formula:**
```
lower_bound = (p + z²/2n - z√(p(1-p)/n + z²/4n²)) / (1 + z²/n)
where p = upvotes/total, n = total votes, z = 1.96 (95% confidence)
```

---

### 4. Feed Algorithms

**Why:** Only "hot" sort exists. Users need "new" (latest), "top" (time-windowed), and "rising" (velocity-based) feeds.

| Aspect | Details |
|--------|---------|
| **Backend** | Add `sort` + `time` params to feed endpoints. Rising = posts < 6h old sorted by votes/hour. Top = net votes filtered by time window (day/week/month/year/all) |
| **Frontend** | Sort tabs + time dropdown on community page |
| **Dependencies** | None |
| **Launch Priority** | P1 — Week 3 |

---

### 5. Moderation Automation (AutoMod)

**Why:** Manual moderation doesn't scale. AutoMod catches spam/scams before humans see them.

| Aspect | Details |
|--------|---------|
| **Backend** | Rule engine: keyword match, regex, account age threshold, karma threshold, link whitelist/blacklist. Rules stored in `Community.settings["automod_rules"]` JSON. Runs as Stage 0 before AI moderation. |
| **Frontend** | Rule editor in moderation dashboard, rule templates for common finance patterns |
| **Dependencies** | Existing moderation pipeline |
| **Launch Priority** | P1 — Week 5 |

---

### 6. Notifications (Real-time)

**Why:** 30-second polling is not real-time. WebSocket push makes the platform feel alive.

| Aspect | Details |
|--------|---------|
| **Backend** | Wire existing `ws_manager.py` to notification events. Channels: `user:{id}:notifications`, `community:{slug}`. Broadcast on: new post in subscribed community, reply to your post/comment, @mention, vote milestone |
| **Frontend** | WebSocket hook in NotificationBell, real-time badge update, toast on new notification |
| **Dependencies** | Existing WebSocket infrastructure |
| **Launch Priority** | P1 — Week 3 |

---

### 7. Ticker Linking + Stock Snapshots

**Why:** Finance-native differentiation. When someone mentions $AAPL, show the price, change, and chart inline.

| Aspect | Details |
|--------|---------|
| **Backend** | Already have `Post.tickers` ARRAY field. Add `GET /api/v1/quotes/batch?symbols=AAPL,TSLA` endpoint (use existing `QuoteCacheService`). Trending tickers endpoint aggregates mentions + price data. |
| **Frontend** | Ticker chips in PostCard linking to `/research?symbol=AAPL`. Hover preview showing price/change. TrendingSidebar wired to live API. |
| **Dependencies** | Existing `quote_cache.py` service |
| **Launch Priority** | P0 — Week 1 (trending), P1 — Week 2 (inline snapshots) |

---

### 8. Search

**Why:** Can't find anything without search. Critical for discoverability.

| Aspect | Details |
|--------|---------|
| **Backend** | PostgreSQL full-text search with `tsvector` + GIN index on `posts.title || posts.body`. Unified `GET /api/v1/search?q=...&type=posts|comments|communities|users`. Filter by community, date range, sentiment. |
| **Frontend** | Search results page with tabs (Posts, Comments, Communities, Users), search bar in header |
| **Dependencies** | PostgreSQL full-text search extensions (built-in) |
| **Launch Priority** | P1 — Week 6 |

---

### 9. Admin/Mod Tools

**Why:** Moderators need to ban users, manage automod, see audit trails, and take bulk actions.

| Aspect | Details |
|--------|---------|
| **Backend** | Ban system (`CommunityBan` model with `expires_at`), bulk moderation (remove all posts by user), mod notes on reports, enhanced audit log with IP + user agent |
| **Frontend** | Ban management page, mod notes editor, bulk action checkboxes |
| **Dependencies** | Existing moderation infrastructure |
| **Launch Priority** | P1 — Week 5 |

---

### 10. User Profiles (Completion)

**Why:** Users can't edit their bio, see saved posts, or view comment history.

| Aspect | Details |
|--------|---------|
| **Backend** | `PATCH /users/me/profile`, `GET /users/{id}/comments`, `GET /users/me/bookmarks` |
| **Frontend** | Profile edit form, comment history tab, bookmarks tab, upvoted/downvoted tabs |
| **Dependencies** | Bookmark model (Week 2) |
| **Launch Priority** | P1 — Week 2 |

---

## D. Reddit & External Data Integration

### Reddit API (PRAW/asyncpraw)

**Package:** `asyncpraw>=7.7.0` (async Reddit API wrapper)

**Credentials needed:**
- Reddit Application: https://www.reddit.com/prefs/apps
- Type: "script" application
- Config keys: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`

**Target subreddits:**

| Subreddit | QuantTrade Community | Category | Focus |
|-----------|---------------------|----------|-------|
| r/wallstreetbets | `wall-street-bets` | stocks | YOLO trades, memes, options plays |
| r/stocks | `stocks` | stocks | Stock analysis, DD, news discussion |
| r/investing | `investing` | macro | Long-term investing, portfolio strategy |
| r/options | `options-trading` | options | Options strategy, Greeks, spreads |
| r/cryptocurrency | `cryptocurrency` | crypto | Crypto markets, DeFi, altcoins |
| r/StockMarket | `stock-market` | stocks | Market analysis, sector rotation |
| r/thetagang | `thetagang` | options | Theta/premium selling strategies |
| r/ValueInvesting | `value-investing` | stocks | Value investing, fundamentals, DCF |

**Ingestion architecture:**

```
Reddit API (asyncpraw)
    ↓
Fetch top 100 posts per subreddit (hot + top weekly)
    ↓
Extract tickers ($AAPL regex), extract metadata
    ↓
Deduplicate by source_url (reddit permalink)
    ↓
Store as Post records (post_type="external", source_platform="reddit")
    ↓
Queue for sentiment scoring (FinBERT)
    ↓
Appear in community feed
```

**Celery schedule:**
- Initial seed: one-time task fetching top 100 from each subreddit
- Ongoing: every 30 minutes, fetch new hot posts
- Rate limit: Reddit allows 60 requests/minute with OAuth

**Attribution (legal requirement):**
- Every Reddit-sourced post displays: "Originally posted on Reddit by u/{author}"
- `source_url` links back to original Reddit post
- `source_platform` = "reddit"
- No modification of original content
- Respect Reddit API Terms of Service

### News Integration

**Sources (already configured):**
- NewsAPI.org — top financial headlines
- Finnhub — company-specific news
- yfinance — real-time news feed

**Auto-posting pipeline (Week 4):**
```
News API fetch (every 4 hours)
    ↓
Filter: financial topics only (keyword + ticker detection)
    ↓
AI summary (Claude) — 2-3 sentence summary
    ↓
Sentiment score (FinBERT)
    ↓
Auto-post to relevant community
    post_type="news", source_platform="newsapi"
    ↓
Deduplicate by headline similarity
```

### Market Data Auto-Posts

**Daily market wrap (Week 4):**
- Trigger: market close (4:00 PM ET)
- Source: existing `data_fetcher.py` + Claude
- Content: SPY/QQQ/DIA close, top movers, sector performance
- Community: `stock-market`
- `post_type="market_update"`

---

## E. ML Sentiment Model

### Architecture: FinBERT

**Model:** `ProsusAI/finbert` (HuggingFace)
- Pre-trained on 10K+ SEC filings, analyst reports, financial news
- 3-class output: positive (bullish), negative (bearish), neutral
- ~110M parameters, ~440MB download
- ~50ms inference on CPU, ~5ms on GPU
- **Zero training required** — use pretrained weights directly

**Why FinBERT over alternatives:**

| Model | Pros | Cons | Decision |
|-------|------|------|----------|
| FinBERT | Pre-trained on financial text, 3-class | 440MB | **Use this** |
| DistilBERT + fine-tune | Smaller (260MB) | Needs 10K+ labeled samples we don't have | Later (Month 3) |
| VADER | Zero ML, fast | Not financial-aware, low accuracy on finance text | Skip |
| GPT-4/Claude | Best accuracy | $0.03/post, too expensive at scale | Skip |

### Service Implementation

**File:** `backend/app/services/sentiment_service.py`

```python
# Architecture:
# - Lazy model loading (same pattern as moderation_service.py)
# - Redis cache: hash(text) -> SentimentResult, 1h TTL
# - Batch API for bulk scoring (Reddit import, backfill)
# - Background task (asyncio.create_task) on post creation

class SentimentResult:
    label: str        # "bullish" | "bearish" | "neutral"
    confidence: float # 0.0 - 1.0
    scores: dict      # {"bullish": 0.8, "bearish": 0.1, "neutral": 0.1}
```

### Integration Points

1. **Post creation** → background task scores sentiment → writes to `Post.sentiment` + `Post.sentiment_confidence`
2. **Reddit ingestion** → batch-score all imported posts
3. **News auto-posting** → score before posting
4. **Feed ranking** → sentiment-weighted variant for "Market Mood" view
5. **Trending** → aggregate sentiment per ticker per time window
6. **User reputation** → bonus points for accurate sentiment predictions (future)

### Real-Time Scoring Pipeline

```
Post Created
    ↓ (non-blocking)
    ├── AI Moderation (existing, ~500ms)
    └── Sentiment Scoring (new, ~50ms)
         ↓
    Post.sentiment = "bullish"
    Post.sentiment_confidence = 0.87
```

### Future: Fine-Tuning (Month 3+)

After accumulating 10K+ posts with user votes as implicit labels:
- Upvoted bullish posts = confirmed bullish
- Downvoted bearish posts = confirmed bearish
- Fine-tune FinBERT on QuantTrade-specific vocabulary
- Add SEC filing sentiment as additional training data

---

## F. Seed Content Strategy

**Rule: Zero mock data. Every piece of content is real.**

### Day 1 Content Sources

| Source | Posts | Method | Attribution |
|--------|-------|--------|-------------|
| Reddit API | 800 | asyncpraw, top 100 per 8 subreddits | "Originally posted on Reddit by u/{author}" |
| Reddit comments | 4,000 | Top 5 comments per post | Same Reddit attribution |
| News API | 20/day | Auto-generated discussion posts | "Source: {publication}" |
| Market wraps | 1/day | AI-generated market commentary | "QuantTrade Market Update" |

### Community Seeding Order

1. **Create communities** — 8 communities with real metadata (name, description, category, rules)
2. **Import Reddit posts** — 800 posts distributed across communities
3. **Import Reddit comments** — Top comments for social proof
4. **Score sentiment** — FinBERT on all imported content
5. **Calculate hot scores** — Reddit hot algorithm on imported posts
6. **Wire trending** — Aggregate ticker mentions from imported posts
7. **Enable user content** — Users can now post alongside seeded content

### Ongoing Content Density

- Reddit sync: 50-100 new posts/day (top posts from each subreddit)
- News auto-posts: 5-10/day (top financial headlines)
- Market wraps: 1/day (market close summary)
- Target: 100+ new posts/day within first week (before organic growth)

---

## G. Launch Readiness Checklist

### Alpha Launch (Internal, Week 3)

- [ ] 800+ real posts in feed
- [ ] 8 communities with real content
- [ ] Live trending tickers (not hardcoded)
- [ ] Community CRUD (create, edit, delete, join, leave)
- [ ] Post creation with image upload
- [ ] Comment threading with basic sort
- [ ] Voting (up/down) with hot score ranking
- [ ] Bookmarks/saves
- [ ] User profile editing
- [ ] Basic moderation (report, review, action)
- [ ] Notification bell with unread count
- [ ] Mobile responsive on all pages
- [ ] No console errors, no broken links

### Beta Launch (Invite-only, Week 5)

- [ ] All alpha items
- [ ] Comment sorting (best/top/new/controversial)
- [ ] Feed sorting (hot/new/top/rising) with time windows
- [ ] @mention notifications
- [ ] WebSocket real-time notifications
- [ ] FinBERT sentiment on all posts
- [ ] Market Mood widget
- [ ] News auto-posting
- [ ] AutoMod rules engine
- [ ] Ban system (temp/permanent)
- [ ] Financial disclaimers
- [ ] Post flairs
- [ ] Full-text search
- [ ] Audit logging complete

### Production Launch (Public, Week 6+)

- [ ] All beta items
- [ ] User verification tiers
- [ ] Notification preferences
- [ ] Redis caching on feeds (<500ms load)
- [ ] Rate limiting on all endpoints
- [ ] Architecture documentation complete
- [ ] API documentation (Swagger) clean
- [ ] End-to-end test suite passing
- [ ] Error monitoring (Sentry or equivalent)
- [ ] Backup and recovery tested

---

## H. Trust & Compliance Layer

### SEC/FINRA Considerations

QuantTrade is a **discussion platform**, not a registered investment advisor (RIA) or broker-dealer. This means:

1. **We do NOT provide personalized investment advice**
2. **Users discuss publicly** — opinions, not recommendations
3. **Disclaimers are mandatory** on every post

### Minimum Controls Before Launch

#### 1. Auto-Disclaimer Injection
Every post renders with footer: *"This is community discussion, not financial advice. Always do your own research."*

Implementation: Add `disclaimer` field to `PostResponse` serialization. Frontend renders as subtle footer.

#### 2. AI Moderation Thresholds (Already Built)

| Score | Action | Example |
|-------|--------|---------|
| > 0.7 | Auto-remove | "Buy now, guaranteed 10x return" |
| 0.3 - 0.7 | Queue for human review | "I think $XYZ is undervalued based on P/E" |
| < 0.3 | Auto-approve | "What do you think about tech sector?" |

**Enhancement:** Lower threshold to 0.2 for posts mentioning penny stocks or OTC tickers.

#### 3. User Verification Tiers

| Tier | Requirements | Capabilities | Badge |
|------|-------------|-------------|-------|
| 0 | Email only | Read, limited posting (3/day) | None |
| 1 | Email + OTP verified | Full posting | Verified checkmark |
| 2 | Admin-approved identity | Exempt from some AutoMod | "Verified" badge |
| 3 | FINRA CRD# verified | "Licensed Professional" tag | Pro badge |

#### 4. Audit Logging (Already Built)

```
audit_log table:
  actor_id, actor_type (user/moderator/admin/system/ai)
  action (create_post, remove_post, ban_user, etc.)
  target_type, target_id
  metadata (JSON with IP, user agent, details)
  created_at
  
Retention: 7 years (SEC compliance standard)
```

#### 5. Content Moderation Detection

Already detecting via `moderation_service.py`:
- Price targets and return guarantees
- Insider information claims
- Pump-and-dump patterns
- Manipulation signals
- Impersonation of financial advisors
- Undisclosed positions

#### 6. Position Disclosure (Week 5)

When a post mentions specific tickers and makes directional claims:
- Prompt author: "Do you hold a position in $AAPL?"
- Store disclosure in `Post.settings["position_disclosure"]`
- Display on post if provided
- Not enforced — voluntary, displayed if provided

---

## I. What Not to Build Yet

| Feature | Why Skip | When to Build |
|---------|----------|---------------|
| **Direct Messages** | Complex real-time infra, low ROI for finance community | Month 3 |
| **Polls** | Nice-to-have, sentiment field serves similar purpose | Month 3 |
| **Crossposting** | Reddit feature, near-zero value at this stage | Month 4 |
| **Awards/Coins Economy** | Reputation badges (computed) are sufficient. Virtual currency is a distraction | Month 4+ |
| **Custom Feed "Multis"** | Power user feature. Community-based feeds are sufficient | Month 4 |
| **Mobile App** | Web works. React Native/Flutter is 3-month project | Month 6+ |
| **Fine-tuning FinBERT** | Need 10K+ labeled samples first. Use pretrained as-is | Month 3 |
| **Video/Audio Posts** | Storage-intensive, moderation-complex | Month 6+ |
| **Reddit OAuth Login** | Legal/privacy complications linking Reddit accounts | Never |
| **Email Notification Digests** | WebSocket + bell icon sufficient for now | Month 3 |
| **Community Wikis** | Content management complexity, low initial value | Month 4 |
| **Trending Algorithms ML** | Hot score + rising is enough. ML-based trending later | Month 4 |

---

## J. Final Sprint Recommendation

### The 6-Week Ship Calendar

| Week | Theme | User-Visible Outcome |
|------|-------|---------------------|
| **1** | Living Feed | 800 real posts, live trending tickers, community management |
| **2** | Rich Content | Bookmarks, image posts, editable profiles, pinned posts |
| **3** | Smart Ranking | Best/controversial comments, rising feed, real-time notifications, @mentions |
| **4** | Intelligence Layer | Sentiment badges on every post, auto news flow, market mood widget |
| **5** | Trust & Scale | AutoMod, bans, compliance disclaimers, flairs, verification badges |
| **6** | Search & Polish | Full-text search, notification preferences, documentation, performance |

### Success Metrics After 6 Weeks

| Metric | Target |
|--------|--------|
| Posts in feed | 1,000+ (800 Reddit + 200 news/market) |
| Sentiment coverage | 100% of posts scored |
| AI moderation accuracy | >90% spam/scam caught before human review |
| Feed load time | <500ms (with Redis caching) |
| API documentation | 100% of endpoints documented |
| Test coverage | End-to-end test suite passing |
| Audit trail | Every moderation action logged |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Reddit API access delay | Apply for credentials immediately (1-3 day approval) |
| FinBERT model size (440MB) | Pre-download in Docker build |
| Database migrations | Use Alembic for all schema changes, never raw SQL |
| Rate limiting | Reddit: 60 req/min, NewsAPI: 100 req/day — build with backoff |
| Content moderation at scale | AutoMod + AI handles 90%, humans handle edge cases |

### Estimated Engineering Effort

| Week | Backend Hours | Frontend Hours | Test Hours | Total |
|------|-------------|----------------|------------|-------|
| 1 | 25 | 7 | 7 | 39 |
| 2 | 21 | 15 | 3 | 39 |
| 3 | 25 | 14 | 3 | 42 |
| 4 | 29 | 9 | 4 | 42 |
| 5 | 30 | 14 | 3 | 47 |
| 6 | 20 | 9 | 8 | 37 |
| **Total** | **150** | **68** | **28** | **246** |

---

## Appendix: New Database Models

### Bookmark
```sql
CREATE TABLE bookmarks (
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX ix_bookmarks_user ON bookmarks(user_id, created_at DESC);
```

### CommunityBan
```sql
CREATE TABLE community_bans (
    id           SERIAL PRIMARY KEY,
    community_id INTEGER REFERENCES communities(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    banned_by    INTEGER REFERENCES users(id),
    reason       TEXT,
    expires_at   TIMESTAMPTZ,  -- NULL = permanent
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(community_id, user_id)
);
```

### Post Model Additions
```sql
ALTER TABLE posts ADD COLUMN source_url TEXT;
ALTER TABLE posts ADD COLUMN source_platform VARCHAR(20);  -- reddit, newsapi, system
ALTER TABLE posts ADD COLUMN sentiment_confidence FLOAT;
ALTER TABLE posts ADD COLUMN flair VARCHAR(50);
```

### Full-Text Search Index
```sql
ALTER TABLE posts ADD COLUMN search_vector tsvector;
CREATE INDEX ix_posts_search ON posts USING GIN(search_vector);

-- Trigger to auto-update search vector
CREATE FUNCTION posts_search_update() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, ''));
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER posts_search_trigger
    BEFORE INSERT OR UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION posts_search_update();
```

---

*Document version 1.0 — Generated April 2026*
*QuantTrade-AI Community Platform Execution Plan*
