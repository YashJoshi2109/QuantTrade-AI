# Copilot Makeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 concrete Copilot bugs (wrong SEC filings, missing comparison snapshots, broken free-tier gate) and overhaul the single-stock snapshot UI to be production-quality.

**Architecture:** Four independent fix areas — RAG retrieval guard, comparison snapshot parallelism, snapshot card UI redesign, free-tier hard lock. All changes stay within existing SSE streaming pipeline; no new endpoints needed.

**Tech Stack:** Python (FastAPI, SQLAlchemy, asyncio, Qdrant client), TypeScript (Next.js 14, Tailwind CSS, Lucide icons, SSE EventSource)

---

## Bug 1: RAG — Wrong Company Filings (AMZN for WMT/COST)

### Root Cause
`hybrid_search.py` applies `ticker=WMT` metadata filter to Qdrant dense search. When WMT/COST have zero indexed chunks, the filter returns 0 results. The fallback runs a filter-free query and returns AMZN (which is heavily indexed and scores high on all financial terms). Frontend renders these AMZN filings as if they belong to the query.

### Fix Design

**`backend/app/services/agentic/retrieval/hybrid_search.py`**

Add ticker-existence pre-check before any search:

```python
async def _ticker_chunk_count(self, ticker: str) -> int:
    result = await self.client.count(
        collection_name=self.collection_name,
        count_filter=Filter(must=[FieldCondition(key="ticker", match=MatchValue(value=ticker))])
    )
    return result.count

async def search(self, query: str, ticker: str | None = None, **kwargs):
    if ticker:
        count = await self._ticker_chunk_count(ticker)
        if count == 0:
            return [], {"no_filings": True, "ticker": ticker}
    # ... existing search logic
```

**`backend/app/api/agentic_stream.py`**

When RAG returns `no_filings=True`, emit a `no_filings` SSE event instead of filing citations:

```python
if rag_result.get("no_filings"):
    yield f"event: no_filings\ndata: {json.dumps({'symbol': ticker})}\n\n"
else:
    # emit citations as normal
```

**Comparison queries:** Run two separate RAG searches (one per ticker), tag each citation with its source ticker. Emit citations as `{"symbol": "WMT", "citations": [...]}` and `{"symbol": "COST", "citations": [...]}`.

**Frontend (`copilot/page.tsx`):**
- Handle `no_filings` event: show inline notice "No SEC filings indexed for WMT — analysis uses public data only"
- Never show filings from a different ticker than the one being analyzed

---

## Bug 2: Missing Snapshots for Comparison Queries

### Root Cause
`agentic_stream.py` calls `build_comprehensive_analysis()` only for `primary_ticker`. When intent is `comparison`, the second ticker has no snapshot emitted. Frontend renders zero snapshot cards for the non-primary ticker.

### Fix Design

**`backend/app/api/agentic_stream.py`**

In the comparison branch, resolve all mentioned tickers and build snapshots in parallel:

```python
if intent == "comparison" and len(all_tickers) >= 2:
    analyses = await asyncio.gather(
        *[build_comprehensive_analysis(sym, db, quote_svc) for sym in all_tickers[:2]],
        return_exceptions=True
    )
    for sym, analysis in zip(all_tickers[:2], analyses):
        if not isinstance(analysis, Exception):
            yield f"event: structured_data\ndata: {json.dumps({'symbol': sym, 'data': analysis})}\n\n"
```

Each `structured_data` event carries its own `symbol` field so the frontend can route it to the correct card slot.

**`frontend/src/app/copilot/page.tsx`**

Replace `structuredData: StructuredData | null` state with:

```typescript
const [snapshots, setSnapshots] = useState<Record<string, StructuredData>>({})

// In SSE handler:
case 'structured_data':
  setSnapshots(prev => ({ ...prev, [parsed.symbol]: parsed.data }))
  break
```

Render:
- `Object.keys(snapshots).length === 1` → full-width single layout (existing)
- `Object.keys(snapshots).length >= 2` → `grid grid-cols-2 gap-4` side-by-side

---

## Bug 3: Free Tier Hard Lock

### Root Cause (two sub-bugs)

**Backend:** Working correctly. `_check_budget()` raises HTTP 429 when daily user message count ≥ 5.

**Frontend bug A:** `getCopilotUsage()` called only on component mount. After each message is sent, the counter stays stale — never decrements.

**Frontend bug B:** The 429 HTTP response from the SSE stream is not wired into any UI state. Input remains enabled even when the user is at limit.

### Fix Design

**`frontend/src/app/copilot/page.tsx`**

```typescript
const [requestsRemaining, setRequestsRemaining] = useState<number>(5)

// After every onDone callback:
const refreshUsage = async () => {
  const usage = await getCopilotUsage()
  setRequestsRemaining(Math.max(0, FREE_TIER_LIMIT - usage.count))
}

// In SSE onDone:
onDone: async () => {
  setIsStreaming(false)
  await refreshUsage()
}

// On 429 SSE error:
onError: (err) => {
  if (err.status === 429) {
    setRequestsRemaining(0)
  }
}
```

**Hard lock UI (input area):**
```tsx
{requestsRemaining === 0 ? (
  <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 text-center">
    <Lock className="w-5 h-5 text-amber-400 mx-auto mb-2" />
    <p className="text-sm text-fg-secondary mb-3">Daily limit reached (5/5 requests used)</p>
    <Button href="/pricing" variant="primary" size="sm">Upgrade to Pro</Button>
  </div>
) : (
  <ChatInput disabled={isStreaming} placeholder="Analyze any stock..." />
)}
```

**Counter in header:** Show `{requestsRemaining} remaining today` next to the 5/5 badge. Badge counts down in real-time. Color: green > 2, amber = 1-2, red = 0.

---

## Feature: Single Stock Snapshot UI Overhaul

### Current State
Cards stacked vertically with minimal styling. Quote card is sparse. Technical/Risk/Monte Carlo cards are plain metric lists. No visual hierarchy. Company name missing. 52W range not shown.

### New Layout

**Three-tier layout per snapshot:**

**Tier 1 — Hero Strip (full width)**
```
┌─────────────────────────────────────────────────────────────┐
│  AAPL  Apple Inc.          $173.42  ▲+1.24%   MKT CLOSED   │
│  Mkt Cap $2.7T · 52W $124–$199 · Vol 54M · Beta 1.2        │
└─────────────────────────────────────────────────────────────┘
```
- Symbol in large mono font, company name in muted text
- Price in xl bold, change% color-coded (green/red)
- Market status pill (OPEN/CLOSED/PRE/POST)
- 52W range bar (current price as a tick on the bar)

**Tier 2 — 3-column metric grid**
```
┌──────────────┬──────────────────────┬──────────────────────┐
│  TECHNICALS  │  REGIME & FORECAST   │  RISK                │
│  RSI 58  ⬤  │  ● Bullish 72%       │  Score 38/100        │
│  MACD ▲ Buy │  1–7d  ▲ +1.4%       │  Sharpe  1.42        │
│  SMA50 ✓    │  1–3m  ▲ +4.2%       │  VaR 95% –3.1%       │
│  BB: midband│  6–12m ◐ Neutral     │  Max DD  –18.2%      │
└──────────────┴──────────────────────┴──────────────────────┘
```
- Each column is a card with icon + title header
- Signal indicators: colored dots (green=bullish, red=bearish, amber=neutral)
- Time horizons: directional arrow + percentage

**Tier 3 — Fundamentals strip (single row)**
```
PE 28× · PEG 1.4 · EPS $6.16 · Div 0.5% · Rev $394B · Net Margin 25%
```
- Horizontal scrollable pill row
- Only shows fields with actual data (no empty placeholders)

**Monte Carlo:** Inline sparkline showing 30d fan (P10/P50/P90 lines) using SVG path — no chart library needed.

**SEC filings:** Collapsible section below snapshot. Always filtered to correct ticker. Shows filing type badge + date. Hides entirely if `no_filings` event received.

### Comparison Mode (side-by-side)
- Two snapshot columns in `grid-cols-2`
- Hero strip in each column shows that ticker's data
- Column headers: ticker symbol as label
- Metric grid 3-col collapses to 2-col per snapshot on smaller screens (`lg:grid-cols-2 md:grid-cols-1`)
- Citation groups labeled per company (no cross-contamination)

---

## File Map

| File | Change |
|------|--------|
| `backend/app/services/agentic/retrieval/hybrid_search.py` | Add `_ticker_chunk_count()` pre-check; return `no_filings` signal |
| `backend/app/api/agentic_stream.py` | Parallel `build_comprehensive_analysis()` for comparison; emit `no_filings` SSE; per-ticker citations |
| `frontend/src/app/copilot/page.tsx` | `snapshots` map state; handle `no_filings` event; `requestsRemaining` counter; hard lock UI |
| `frontend/src/app/api/copilot/stream/route.ts` | Forward 429 status to frontend (currently swallowed) |
| `frontend/src/components/copilot/copilot-snapshot-cards.tsx` | Full UI overhaul: hero strip, 3-col grid, fundamentals strip, Monte Carlo sparkline |
| `frontend/src/app/copilot/page.tsx` (session restore) | Save/restore conversation state via sessionStorage on unmount/mount |

---

## Bug 4: Conversation Resets on Navigation

### Root Cause
`/copilot/page.tsx` is a Next.js page component. Navigating away (Dashboard, Markets, etc.) and returning causes a full React remount — all `useState` values reset to initial. The user's typed input and active conversation are lost.

### Fix Design

**`frontend/src/app/copilot/page.tsx`**

On unmount: save active state to `sessionStorage`.
On mount: restore from `sessionStorage`.

```typescript
const SESSION_KEY = 'qt_copilot_session'

// Save on unmount
useEffect(() => {
  return () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      activeConversationId,
      messages,
      pendingInput: inputValue,
    }))
  }
}, [activeConversationId, messages, inputValue])

// Restore on mount
useEffect(() => {
  const saved = sessionStorage.getItem(SESSION_KEY)
  if (saved) {
    const { activeConversationId: cid, messages: msgs, pendingInput } = JSON.parse(saved)
    if (cid) setActiveConversationId(cid)
    if (msgs?.length) setMessages(msgs)
    if (pendingInput) setInputValue(pendingInput)
  }
}, [])
```

**Constraint:** Only restore if session is same browser tab (sessionStorage is tab-scoped by design). Do not restore across page refreshes (intentional reset). Active streaming state is NOT restored (user must re-send if they navigate during a stream).

**File:** `frontend/src/app/copilot/page.tsx` only — no backend changes needed.

---

## Out of Scope
- MLOps architectural changes (separate spec)
- Ingesting WMT/COST filings into Qdrant (data pipeline concern, not UI bug)
- Changing the 5/day free tier limit
- Pro user snapshot features beyond current data model
