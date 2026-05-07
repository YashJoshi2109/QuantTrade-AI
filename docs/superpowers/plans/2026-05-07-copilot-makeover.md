# Copilot Makeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 Copilot bugs (wrong SEC filings, missing comparison snapshots, broken free-tier hard lock, conversation reset on navigation) and overhaul the single-stock snapshot card UI.

**Architecture:** Six independent tasks in dependency order: RAG ticker guard (backend) → comparison snapshots (backend+frontend) → free-tier hard lock (frontend) → nav persistence (frontend) → snapshot UI overhaul (frontend). No new endpoints, no schema migrations.

**Tech Stack:** Python 3.11 (FastAPI, SQLAlchemy, Qdrant client, asyncio), TypeScript (Next.js 14, React, Tailwind CSS, Lucide icons, React Query)

---

## File Map

| File | Change |
|------|--------|
| `backend/app/services/agentic/retrieval/hybrid_search.py` | Add `ticker_has_filings()` pre-check function |
| `backend/app/api/agentic_stream.py` | Citation ticker filter + `no_filings` SSE + parallel comparison snapshots |
| `frontend/src/lib/copilot-engine.ts` | Add `onNoFilings` callback type |
| `frontend/src/app/copilot/page.tsx` | Multi-snapshot accumulation, `no_filings` handler, free-tier hard lock, sessionStorage persistence |
| `frontend/src/components/copilot/copilot-snapshot-cards.tsx` | Full `SnapshotCard` UI overhaul |

---

## Task 1: RAG Ticker Guard — Backend

**Files:**
- Modify: `backend/app/services/agentic/retrieval/hybrid_search.py` (add after line 106)
- Test: `backend/tests/test_hybrid_search_guard.py` (create)

**Scene:** The root cause of AMZN filings appearing for WMT/COST queries is that when a ticker has zero indexed chunks in Qdrant, the metadata filter returns nothing, and the fallback returns whatever is in the collection (AMZN). This task adds a fast pre-check. The fix in Task 2 will use this to filter citations post-graph.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_hybrid_search_guard.py`:

```python
"""Tests for RAG ticker existence pre-check."""
import pytest
from unittest.mock import MagicMock, patch


def test_ticker_has_filings_returns_true_when_chunks_exist():
    mock_client = MagicMock()
    mock_client.count.return_value = MagicMock(count=42)

    with patch(
        "app.services.agentic.retrieval.hybrid_search._qdrant_client",
        return_value=mock_client,
    ):
        from app.services.agentic.retrieval.hybrid_search import ticker_has_filings
        result = ticker_has_filings(["AAPL"])
    assert result is True


def test_ticker_has_filings_returns_false_when_no_chunks():
    mock_client = MagicMock()
    mock_client.count.return_value = MagicMock(count=0)

    with patch(
        "app.services.agentic.retrieval.hybrid_search._qdrant_client",
        return_value=mock_client,
    ):
        from app.services.agentic.retrieval.hybrid_search import ticker_has_filings
        result = ticker_has_filings(["WMT"])
    assert result is False


def test_ticker_has_filings_returns_true_if_any_ticker_has_chunks():
    mock_client = MagicMock()
    # First call returns 0, second returns 10
    mock_client.count.side_effect = [MagicMock(count=0), MagicMock(count=10)]

    with patch(
        "app.services.agentic.retrieval.hybrid_search._qdrant_client",
        return_value=mock_client,
    ):
        from app.services.agentic.retrieval.hybrid_search import ticker_has_filings
        result = ticker_has_filings(["WMT", "COST"])
    assert result is True
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend
python -m pytest tests/test_hybrid_search_guard.py -v 2>&1 | head -30
```

Expected: `ImportError: cannot import name 'ticker_has_filings'`

- [ ] **Step 3: Implement `ticker_has_filings` in hybrid_search.py**

Add this function after line 106 (after `rrf_fusion`), before `_dense_search`:

```python
def ticker_has_filings(tickers: list[str]) -> bool:
    """Return True if ANY of the requested tickers have indexed chunks in Qdrant.

    Synchronous — uses run_in_executor in async callers.
    Returns False only when ALL tickers have zero chunks, preventing wrong-ticker fallback.
    """
    if not tickers:
        return False
    client = _qdrant_client()
    for ticker in tickers:
        try:
            result = client.count(
                collection_name=CHUNKS_COLLECTION,
                count_filter=Filter(
                    must=[FieldCondition(key="ticker", match=MatchValue(value=ticker.upper()))]
                ),
                exact=False,
            )
            if result.count > 0:
                return True
        except Exception as exc:
            logger.warning("ticker_has_filings check failed for %s: %s", ticker, exc)
    return False
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend
python -m pytest tests/test_hybrid_search_guard.py -v
```

Expected: all 3 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agentic/retrieval/hybrid_search.py \
        backend/tests/test_hybrid_search_guard.py
git commit -m "fix(rag): add ticker_has_filings pre-check to prevent wrong-company filing fallback"
```

---

## Task 2: Citation Ticker Filter + Comparison Snapshots — Backend

**Files:**
- Modify: `backend/app/api/agentic_stream.py` (lines 254–263 for snapshots, lines 261–263 for citations)
- Test: `backend/tests/test_agentic_stream_citations.py` (create)

**Scene:** Two changes in one file:
1. Filter citations by requested ticker — if AMZN slipped in via RAG fallback, remove it before emitting. If nothing remains, emit `no_filings` instead.
2. For comparison queries (2+ tickers in `all_tickers`), build and emit `structured_data` for each ticker in parallel so the frontend can show side-by-side cards.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_agentic_stream_citations.py`:

```python
"""Unit tests for citation filtering and comparison snapshot emission."""
import json
import pytest


def _collect_sse_events(gen):
    """Drain a sync generator of SSE strings into a list of (event, data) tuples."""
    events = []
    for chunk in gen:
        if chunk.startswith("event:"):
            lines = chunk.strip().split("\n")
            event = lines[0].replace("event: ", "")
            data = json.loads(lines[1].replace("data: ", ""))
            events.append((event, data))
    return events


def test_citations_filtered_to_requested_ticker():
    """AMZN citations must be dropped when query is about WMT."""
    from app.api.agentic_stream import _filter_citations_by_tickers
    citations = [
        {"ticker": "AMZN", "title": "Amazon 10-K", "source_n": 1},
        {"ticker": "WMT", "title": "Walmart 10-K", "source_n": 2},
    ]
    result = _filter_citations_by_tickers(citations, ["WMT"])
    assert len(result) == 1
    assert result[0]["ticker"] == "WMT"


def test_citations_all_filtered_returns_empty():
    from app.api.agentic_stream import _filter_citations_by_tickers
    citations = [
        {"ticker": "AMZN", "title": "Amazon 10-K", "source_n": 1},
    ]
    result = _filter_citations_by_tickers(citations, ["WMT", "COST"])
    assert result == []
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend
python -m pytest tests/test_agentic_stream_citations.py -v 2>&1 | head -20
```

Expected: `ImportError: cannot import name '_filter_citations_by_tickers'`

- [ ] **Step 3: Add `_filter_citations_by_tickers` helper in agentic_stream.py**

Add after the `_sse` helper (after line 180):

```python
def _filter_citations_by_tickers(
    citations: list[dict],
    requested_tickers: list[str],
) -> list[dict]:
    """Remove citations whose ticker doesn't match the requested tickers.

    Prevents AMZN filings from appearing for WMT/COST queries when AMZN
    has indexed chunks but WMT/COST don't.
    If requested_tickers is empty, returns citations unchanged.
    """
    if not requested_tickers:
        return citations
    upper = {t.upper() for t in requested_tickers}
    return [c for c in citations if c.get("ticker", "").upper() in upper]
```

- [ ] **Step 4: Replace citation emission block in `_stream_generator` (lines 254–263)**

Find this block in `_stream_generator`:

```python
    # Emit structured data for UI stock panels (quote + fundamentals)
    ticker = rd_dict.get("primary_ticker")
    if ticker:
        structured = _build_structured_data(ticker, state)
        if structured:
            yield _sse("structured_data", structured)

    # Emit citations early (frontend can start rendering)
    for i, cit in enumerate(citations[:10]):
        yield _sse("citation", {**cit, "source_n": i + 1})
```

Replace with:

```python
    # ── Structured data ───────────────────────────────────────────────────────
    # For comparison queries, emit one structured_data per ticker (parallel build)
    all_snap_tickers: list[str] = rd_dict.get("all_tickers") or []
    if not all_snap_tickers and rd_dict.get("primary_ticker"):
        all_snap_tickers = [rd_dict["primary_ticker"]]

    if len(all_snap_tickers) >= 2:
        # Comparison: build both snapshots in parallel via thread pool
        import asyncio as _asyncio
        loop = _asyncio.get_event_loop()
        snap_tasks = [
            loop.run_in_executor(None, _build_structured_data, t, state)
            for t in all_snap_tickers[:2]
        ]
        snap_results = await _asyncio.gather(*snap_tasks, return_exceptions=True)
        for snap in snap_results:
            if snap and not isinstance(snap, Exception):
                yield _sse("structured_data", snap)
    elif all_snap_tickers:
        structured = _build_structured_data(all_snap_tickers[0], state)
        if structured:
            yield _sse("structured_data", structured)

    # ── Citations — filtered to requested tickers ─────────────────────────────
    requested_tickers = [t for t in (rd_dict.get("all_tickers") or []) if t]
    filtered_citations = _filter_citations_by_tickers(citations, requested_tickers)

    if requested_tickers and not filtered_citations:
        # No matching filings indexed — tell frontend to show notice, not wrong docs
        for t in requested_tickers[:2]:
            yield _sse("no_filings", {"symbol": t.upper()})
    else:
        for i, cit in enumerate(filtered_citations[:10]):
            yield _sse("citation", {**cit, "source_n": i + 1})
```

- [ ] **Step 5: Run the citation filter test**

```bash
cd backend
python -m pytest tests/test_agentic_stream_citations.py -v
```

Expected: both PASS

- [ ] **Step 6: Verify TypeScript build is clean (no backend-side TS)**

```bash
cd backend
python -c "from app.api.agentic_stream import _filter_citations_by_tickers; print('OK')"
```

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/agentic_stream.py \
        backend/tests/test_agentic_stream_citations.py
git commit -m "fix(copilot): filter citations to requested tickers, emit no_filings SSE, parallel comparison snapshots"
```

---

## Task 3: Frontend — Multi-Snapshot State + no_filings Handler

**Files:**
- Modify: `frontend/src/lib/copilot-engine.ts` (add `onNoFilings` callback)
- Modify: `frontend/src/app/copilot/page.tsx` (accumulate snapshots, handle `no_filings`)

**Scene:** The backend now emits two `structured_data` events for comparison queries. The frontend `onStructuredData` currently overwrites state on each event. This task makes it accumulate the second event into `stocks[]` on the message's `structuredData`. It also wires up the new `no_filings` SSE event to show an inline notice rather than wrong documents.

- [ ] **Step 1: Add `onNoFilings` callback to copilot-engine.ts**

In `frontend/src/lib/copilot-engine.ts`, find the `CopilotCallbacks` interface (around line 205–215) and add `onNoFilings`:

```typescript
export interface CopilotCallbacks {
  onIntent?: (intent: CopilotIntent, symbol: string | null, symbols: string[]) => void
  onStructuredData?: (data: CopilotStructuredData) => void
  onToolCall?: (message: string) => void
  onToolResult?: (message: string) => void
  onToken?: (text: string) => void
  onMeta?: (meta: CopilotMeta) => void
  onCitation?: (citation: CitationData) => void
  onNoFilings?: (symbol: string) => void   // ← add this line
  onError?: (error: string) => void
  onDone?: () => void
}
```

Also in the SSE event parser (around line 295–310 where `case 'citation':` is handled), add a `case 'no_filings':` branch:

```typescript
case 'no_filings':
  callbacks.onNoFilings?.(parsed.symbol as string)
  break
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Update `onStructuredData` handler in page.tsx to accumulate comparison snapshots**

In `frontend/src/app/copilot/page.tsx`, find the `onStructuredData` callback inside `sendMessage` (around line 2054–2073):

```typescript
          onStructuredData: (data) => {
            setPipelineStage('streaming')
            const displayData =
              data.stocks && data.stocks.length > 0
                ? data.stocks[0]
                : (data as StockAnalysisData)
            // Only auto-show the full dashboard when rich ML data is present
            // (technical_signal, confidence, monte_carlo). For simple quote data
            // the StockQuickPanel already provides a better experience.
            if (displayData.symbol) {
              const hasRichData = !!(displayData.technical_signal || displayData.confidence || displayData.monte_carlo)
              setAnalysisData(displayData)
              if (hasRichData) setShowDashboard(true)
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, structuredData: data } : m
              )
            )
          },
```

Replace with:

```typescript
          onStructuredData: (data) => {
            setPipelineStage('streaming')
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m
                const existing = m.structuredData
                // Accumulate second structured_data event into stocks[] for comparison layout
                if (
                  existing?.symbol &&
                  data.symbol &&
                  existing.symbol !== data.symbol &&
                  !existing.stocks?.length
                ) {
                  const merged: CopilotStructuredData = {
                    ...existing,
                    stocks: [existing as StockAnalysisData, data as StockAnalysisData],
                  }
                  return { ...m, structuredData: merged }
                }
                return { ...m, structuredData: data }
              })
            )
            const displayData = data.stocks?.[0] ?? (data as StockAnalysisData)
            if (displayData.symbol) {
              const hasRichData = !!(displayData.technical_signal || displayData.confidence || displayData.monte_carlo)
              setAnalysisData(displayData)
              if (hasRichData) setShowDashboard(true)
            }
          },
```

- [ ] **Step 4: Add `onNoFilings` handler + `noFilingSymbols` state**

In `CopilotInner`, add state declaration near the other `useState` calls (around line 1850):

```typescript
  const [noFilingSymbols, setNoFilingSymbols] = useState<string[]>([])
```

Inside `sendMessage`, add `onNoFilings` callback (after `onCitation` handler, before `onToken`):

```typescript
          onNoFilings: (symbol) => {
            setNoFilingSymbols((prev) => prev.includes(symbol) ? prev : [...prev, symbol])
          },
```

Also reset it when sending a new message — add to the reset block at the top of `sendMessage` (around line 2013–2021):

```typescript
      setNoFilingSymbols([])
```

- [ ] **Step 5: Show no-filings notice in message bubble**

In `copilot/page.tsx`, find the `MessageBubble` component or where citations are rendered. Inside `InlineStructuredSnapshots` in `copilot-snapshot-cards.tsx` (this is rendered inside message bubbles) — we don't have access to `noFilingSymbols` there.

Instead, render the notice inline in the message stream. In `CopilotInner`'s render, find where `PipelineStatus` is rendered (around line 2300–2307) and add a no-filings notice that appears below the pipeline status during streaming:

Actually, the cleanest place is to show it in the message content area. In the `onNoFilings` callback, append a small notice to the assistant message content by updating its `meta`:

Replace the `onNoFilings` callback with:

```typescript
          onNoFilings: (symbol) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m
                const existing = m.meta?.noFilings ?? []
                return {
                  ...m,
                  meta: {
                    ...(m.meta ?? {}),
                    noFilings: existing.includes(symbol) ? existing : [...existing, symbol],
                  },
                }
              })
            )
          },
```

In the `Message` interface (around line 91–101), `meta` is typed as `CopilotMeta`. Add `noFilings` to it:

Find `CopilotMeta` in `copilot-engine.ts`:

```typescript
export interface CopilotMeta {
  conversation_id?: string
  request_id?: string
  model?: string
  citations?: CitationData[]
  noFilings?: string[]    // ← add this
}
```

In `MessageBubble` or wherever `msg.meta` is rendered, add after the citations section:

```typescript
{msg.meta?.noFilings && msg.meta.noFilings.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-1.5">
    {msg.meta.noFilings.map((sym) => (
      <span key={sym} className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[10px] text-amber-400">
        No SEC filings indexed for {sym} — analysis uses public data only
      </span>
    ))}
  </div>
)}
```

Find where `MessageBubble` renders citations in `page.tsx` (search for `msg.citations` in the render logic) and add the `noFilings` notice right after the citations block.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/copilot-engine.ts \
        frontend/src/app/copilot/page.tsx
git commit -m "fix(copilot): accumulate comparison snapshots into stocks[], wire no_filings SSE notice"
```

---

## Task 4: Free Tier Hard Lock — Frontend

**Files:**
- Modify: `frontend/src/app/copilot/page.tsx` (lines ~1838–2382, `CopilotInner`)

**Scene:** The `CopilotPromptInput` receives `usage` and shows a banner, but the input is only `disabled={streaming}`. When `free_remaining` drops to 0, users can still type and submit — the backend rejects it, but there's no UI gate. This task replaces the input with a hard-locked upgrade panel when the limit is reached.

- [ ] **Step 1: Add `Lock` to the lucide-react imports**

Find the lucide-react import line near the top of `page.tsx` (around line 5–15) and add `Lock` to the destructured list:

```typescript
import {
  // ... existing icons ...
  Lock,
  // ... rest ...
} from 'lucide-react'
```

- [ ] **Step 2: Compute `isAtLimit` in `CopilotInner`**

After the `copilotUsage` query declaration (around line 1929–1933):

```typescript
  const { data: copilotUsage } = useQuery({
    queryKey: ['copilot-usage'],
    queryFn: getCopilotUsage,
    staleTime: 30_000,
  })
```

Add immediately after:

```typescript
  const isAtLimit = Boolean(
    copilotUsage && !copilotUsage.is_pro && copilotUsage.free_remaining <= 0
  )
```

- [ ] **Step 3: Replace the input section with hard-lock gate**

Find the input section in `CopilotInner` (around line 2354–2381):

```tsx
        {/* Input — glass composer */}
        <div className="relative shrink-0 border-t border-line-subtle bg-surface-glass px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
          <div
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#007AFF]/35 to-transparent"
            aria-hidden
          />
          <div className="shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
            <CopilotPromptInput
              ref={inputRef}
              variant="magic"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Analyze any stock, compare tickers, explore sectors, assess risk..."
              disabled={streaming}
              streaming={streaming}
              onSend={() => sendMessage(input)}
              onStop={stopStreaming}
              usage={copilotUsage ?? null}
              onUpgrade={() => router.push('/pricing')}
            />
          </div>

          <p className="mt-2.5 text-center text-[10px] leading-relaxed text-fg-muted">
            Enter to send · Shift+Enter for new line · Full pipeline: RAG → Quant → LLM · Not
            financial advice
          </p>
        </div>
```

Replace with:

```tsx
        {/* Input — glass composer */}
        <div className="relative shrink-0 border-t border-line-subtle bg-surface-glass px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
          <div
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#007AFF]/35 to-transparent"
            aria-hidden
          />
          {isAtLimit ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-5 text-center">
              <Lock className="h-5 w-5 text-amber-400" />
              <div>
                <p className="text-sm font-medium text-fg-primary">Daily limit reached</p>
                <p className="mt-0.5 text-xs text-fg-muted">5/5 free requests used today. Resets at midnight UTC.</p>
              </div>
              <button
                type="button"
                onClick={() => router.push('/pricing')}
                className="rounded-xl bg-gradient-to-br from-[#0a84ff] to-[#0060c9] px-5 py-2 text-sm font-semibold text-white shadow-[0_0_24px_rgba(0,122,255,0.25)] transition-all hover:brightness-110"
              >
                Upgrade to Pro — Unlimited Access
              </button>
            </div>
          ) : (
            <div className="shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
              <CopilotPromptInput
                ref={inputRef}
                variant="magic"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Analyze any stock, compare tickers, explore sectors, assess risk..."
                disabled={streaming}
                streaming={streaming}
                onSend={() => sendMessage(input)}
                onStop={stopStreaming}
                usage={copilotUsage ?? null}
                onUpgrade={() => router.push('/pricing')}
              />
            </div>
          )}

          {!isAtLimit && (
            <p className="mt-2.5 text-center text-[10px] leading-relaxed text-fg-muted">
              Enter to send · Shift+Enter for new line · Full pipeline: RAG → Quant → LLM · Not
              financial advice
            </p>
          )}
        </div>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/copilot/page.tsx
git commit -m "fix(copilot): hard-lock input when free tier exhausted, show upgrade panel"
```

---

## Task 5: Navigation Persistence — sessionStorage

**Files:**
- Modify: `frontend/src/app/copilot/page.tsx` (`CopilotInner` component)

**Scene:** Next.js fully unmounts the page component when the user navigates away. All state (messages, conversation ID, typed input) resets. This task saves state to `sessionStorage` on unmount and restores on mount — so navigating Dashboard → Copilot → back to Copilot restores the conversation.

- [ ] **Step 1: Add session save/restore to `CopilotInner`**

In `CopilotInner`, after the `abortRef` and `bottomRef` declarations (around line 1857–1860), add:

```typescript
  const SESSION_KEY = 'qt_copilot_session'

  // Keep a ref to current state values for the unmount cleanup
  const sessionSaveRef = useRef({ messages, activeConversationId, input })
  useEffect(() => {
    sessionSaveRef.current = { messages, activeConversationId, input }
  }, [messages, activeConversationId, input])
```

- [ ] **Step 2: Add mount restore effect**

Add this effect immediately after the `sessionSaveRef` block:

```typescript
  // Restore conversation from sessionStorage on mount (after navigating back)
  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return
    sessionStorage.removeItem(SESSION_KEY) // consume so refresh starts fresh
    try {
      const saved = JSON.parse(raw) as {
        messages?: Message[]
        conversationId?: string | null
        input?: string
      }
      if (saved.messages?.length) {
        setMessages(
          saved.messages.map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp),
            streaming: false, // never restore mid-stream
          }))
        )
      }
      if (saved.conversationId) setActiveConversationId(saved.conversationId)
      if (saved.input) setInput(saved.input)
    } catch {
      // corrupted session — ignore
    }
  }, []) // empty deps: mount only
```

- [ ] **Step 3: Add unmount save effect**

Add this effect right after the mount restore effect:

```typescript
  // Save conversation to sessionStorage on unmount (navigation away)
  useEffect(() => {
    return () => {
      const { messages: m, activeConversationId: cid, input: inp } = sessionSaveRef.current
      if (!m.length && !cid) return // nothing to save
      try {
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            messages: m.filter((msg) => !msg.streaming), // never persist mid-stream messages
            conversationId: cid,
            input: inp,
          })
        )
      } catch {
        // sessionStorage full or unavailable — ignore
      }
    }
  }, []) // empty deps: cleanup runs only on unmount
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/copilot/page.tsx
git commit -m "fix(copilot): restore conversation from sessionStorage after tab navigation"
```

---

## Task 6: Snapshot Card UI Overhaul

**Files:**
- Modify: `frontend/src/components/copilot/copilot-snapshot-cards.tsx` (full rewrite of `SnapshotCard`)

**Scene:** Current `SnapshotCard` is a minimal 3-section card: symbol+badge / price / OHLCV 4-col grid. It's missing company name prominence, 52W range visual, fundamentals, and any hierarchy. This task rewrites `SnapshotCard` to a 4-tier layout: hero strip → 52W bar → 3-col metrics grid → fundamentals pill strip. `InlineStructuredSnapshots` already handles comparison via `grid-cols-2` — no changes needed there.

- [ ] **Step 1: Rewrite `SnapshotCard` in copilot-snapshot-cards.tsx**

Replace the entire `SnapshotCard` function (lines 49–114) with the new implementation below. `ConfidenceGauge` and `InlineStructuredSnapshots` stay unchanged.

```tsx
export function SnapshotCard({ data }: { data: StockAnalysisData }) {
  const quote = data.quote
  const company = data.company
  const ts = data.technical_signal
  const conf = data.confidence
  const fund = data.fundamentals
  const regime = data.regime
  const risk = data.risk
  const timeH = data.time_horizons

  const price = quote?.price
  const changePct = quote?.change_percent ?? 0
  const isUp = changePct >= 0

  // 52-week range position (0–100%)
  const w52Hi = fund?.week_52_high
  const w52Lo = fund?.week_52_low
  const rangePct =
    price != null && w52Hi != null && w52Lo != null && w52Hi > w52Lo
      ? Math.max(0, Math.min(100, ((price - w52Lo) / (w52Hi - w52Lo)) * 100))
      : null

  const fmt = (n?: number | null, prefix = '$') =>
    n == null ? 'N/A' : `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  const fmtPct = (n?: number | null) =>
    n == null ? 'N/A' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
  const fmtMktCap = (n?: number | null) => {
    if (n == null) return 'N/A'
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${n.toLocaleString()}`
  }

  return (
    <div className="rounded-xl border border-slate-700/50 bg-[#0D1117] overflow-hidden">

      {/* ── Tier 1: Hero strip ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xl font-bold text-white">{data.symbol}</span>
            {ts && (
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${trendBg(ts.trend)} ${trendColor(ts.trend)}`}>
                {ts.trend}
              </span>
            )}
            {regime && (
              <span className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                {regime.regime}
              </span>
            )}
          </div>
          {company?.name && (
            <p className="mt-0.5 text-sm text-fg-secondary truncate max-w-[200px]">{company.name}</p>
          )}
          {(company?.sector || company?.industry) && (
            <p className="text-[10px] text-fg-muted">
              {[company.sector, company.industry].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {conf && <ConfidenceGauge score={conf.overall} grade={conf.grade} label={conf.label} />}
      </div>

      {/* Price + change */}
      {price != null && (
        <div className="flex items-end gap-3 px-4 pb-2">
          <span className="font-mono text-3xl font-bold text-white">{fmt(price)}</span>
          <span className={`flex items-center gap-0.5 text-sm font-semibold mb-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            {fmtPct(changePct)}
          </span>
          {quote?.volume && (
            <span className="text-[10px] text-fg-muted mb-0.5 ml-auto">
              Vol {(quote.volume / 1e6).toFixed(1)}M
            </span>
          )}
        </div>
      )}

      {/* ── Tier 2: 52-Week Range Bar ───────────────────────────────────────── */}
      {rangePct != null && (
        <div className="px-4 pb-3">
          <div className="flex justify-between text-[9px] text-fg-muted mb-1">
            <span>52W Lo {fmt(w52Lo)}</span>
            <span>52W Hi {fmt(w52Hi)}</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-surface-raised">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400"
              style={{ width: `${rangePct}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 rounded-full bg-white"
              style={{ left: `calc(${rangePct}% - 1px)` }}
            />
          </div>
        </div>
      )}

      {/* ── Tier 3: 3-column metrics grid ──────────────────────────────────── */}
      {(ts || regime || risk) && (
        <div className="grid grid-cols-3 divide-x divide-slate-700/40 border-t border-slate-700/40 text-[10px]">
          {/* Technicals */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">Technicals</div>
            {ts?.bullish_pct != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Bullish</span>
                <span className={`font-mono font-semibold ${trendColor(ts.trend)}`}>{ts.bullish_pct.toFixed(0)}%</span>
              </div>
            )}
            {ts?.signals?.slice(0, 3).map((sig, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-fg-muted truncate">{sig.name}</span>
                <span className={sig.signal === 'bullish' ? 'text-emerald-400' : sig.signal === 'bearish' ? 'text-red-400' : 'text-fg-muted'}>
                  {sig.signal.toUpperCase()}
                </span>
              </div>
            ))}
          </div>

          {/* Regime & Forecast */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">Forecast</div>
            {regime && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Regime</span>
                <span className="text-cyan-400 font-semibold capitalize">{regime.regime}</span>
              </div>
            )}
            {timeH && (
              <>
                {[
                  { label: '1–7d', h: timeH.short_term },
                  { label: '1–3m', h: timeH.medium_term },
                  { label: '6–12m', h: timeH.long_term },
                ].map(({ label, h }) => h && (
                  <div key={label} className="flex justify-between">
                    <span className="text-fg-muted">{label}</span>
                    <span className={h.direction === 'up' ? 'text-emerald-400' : h.direction === 'down' ? 'text-red-400' : 'text-fg-muted'}>
                      {h.direction === 'up' ? '▲' : h.direction === 'down' ? '▼' : '◐'}{' '}
                      {h.predicted_return != null ? fmtPct(h.predicted_return * 100) : ''}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Risk */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-fg-muted mb-1.5">Risk</div>
            {risk?.score != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Score</span>
                <span className={`font-mono font-bold ${risk.score <= 33 ? 'text-emerald-400' : risk.score <= 66 ? 'text-amber-400' : 'text-red-400'}`}>
                  {risk.score}/100
                </span>
              </div>
            )}
            {risk?.enhanced?.sharpe_ratio != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">Sharpe</span>
                <span className="font-mono text-fg-secondary">{risk.enhanced.sharpe_ratio.toFixed(2)}</span>
              </div>
            )}
            {risk?.enhanced?.var_95_pct != null && (
              <div className="flex justify-between">
                <span className="text-fg-muted">VaR 95%</span>
                <span className="font-mono text-red-400">{risk.enhanced.var_95_pct.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tier 4: OHLCV + key fundamentals ──────────────────────────────── */}
      <div className="border-t border-slate-700/40 px-4 py-2.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          {quote?.open != null && <span><span className="text-fg-muted">O </span><span className="font-mono text-fg-secondary">{fmt(quote.open)}</span></span>}
          {quote?.high != null && <span><span className="text-fg-muted">H </span><span className="font-mono text-emerald-400">{fmt(quote.high)}</span></span>}
          {quote?.low != null && <span><span className="text-fg-muted">L </span><span className="font-mono text-red-400">{fmt(quote.low)}</span></span>}
          {fund?.market_cap != null && <span><span className="text-fg-muted">MktCap </span><span className="font-mono text-fg-secondary">{fmtMktCap(fund.market_cap)}</span></span>}
          {fund?.pe_ratio != null && <span><span className="text-fg-muted">PE </span><span className="font-mono text-fg-secondary">{fund.pe_ratio.toFixed(1)}×</span></span>}
          {fund?.eps != null && <span><span className="text-fg-muted">EPS </span><span className="font-mono text-fg-secondary">{fmt(fund.eps)}</span></span>}
          {fund?.beta != null && <span><span className="text-fg-muted">β </span><span className="font-mono text-fg-secondary">{fund.beta.toFixed(2)}</span></span>}
          {fund?.dividend_yield != null && fund.dividend_yield > 0 && (
            <span><span className="text-fg-muted">Div </span><span className="font-mono text-fg-secondary">{(fund.dividend_yield * 100).toFixed(2)}%</span></span>
          )}
        </div>
      </div>
    </div>
  )
}
```

Note: `TimeHorizon` type needs a `direction` field. Verify it's in `copilot-engine.ts`:

```typescript
export interface TimeHorizon {
  direction: 'up' | 'down' | 'neutral'
  predicted_return?: number
  confidence?: number
}
```

If `direction` is missing, add it to the interface.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. If `TimeHorizon` is missing `direction`, add it and re-check.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/copilot/copilot-snapshot-cards.tsx \
        frontend/src/lib/copilot-engine.ts
git commit -m "feat(copilot): overhaul snapshot card UI — hero strip, 52W bar, 3-col metrics, fundamentals strip"
```

---

## Task 7: Final TypeScript Build Verification

**Files:** None new — verification only.

- [ ] **Step 1: Full TypeScript check**

```bash
cd frontend
npx tsc --noEmit 2>&1
```

Expected: clean (zero errors)

- [ ] **Step 2: Full backend tests**

```bash
cd backend
python -m pytest tests/test_hybrid_search_guard.py tests/test_agentic_stream_citations.py -v
```

Expected: all tests PASS

- [ ] **Step 3: Push**

```bash
git push origin main
```

Expected: CI goes green (Deploy to Production passes)
