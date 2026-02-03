# Frontend Rate Limiting Guide

This guide documents how to use the `priority` parameter and related hooks for rate‑limited Finnhub endpoints. It is documentation only (not compiled).

## Priority Levels

**High priority (`priority=high`)**
- Research page (real‑time stock details)
- Markets page (indices and trending stocks)
- User‑initiated actions (Refresh button)
- Behavior: waits up to 10 seconds if rate‑limited

**Normal priority (`priority=normal`)**
- Dashboard (multiple tickers)
- Background polling (30–60s)
- Secondary data (news, sentiment)
- Behavior: skips API call and returns cached/empty data if rate‑limited

---

## 1) Research Page — High Priority Quotes

```tsx
// frontend/src/app/research/page.tsx
const { data: realtimeQuote } = useRealtimeQuote({
  symbol: selectedSymbol,
  refetchInterval: 5000,
  priority: 'high',
  useFinnhub: true,
})
```

---

## 2) Markets Page — High Priority Indices

```tsx
// frontend/src/app/markets/page.tsx
const { data: indexQuotes } = useRealtimeQuotes(
  INDEX_SYMBOLS,
  10000,
  'high'
)
```

---

## 3) Dashboard — Normal Priority Watchlist

```tsx
// frontend/src/app/page.tsx
const { data: quotes } = useRealtimeQuotes(
  symbols,
  30000,
  'normal'
)
```

---

## 4) Custom Hook — `useRealtimeQuote`

```tsx
// frontend/src/hooks/useRealtimeQuote.ts
const { quote, loading, error } = useRealtimeQuote({
  symbol: 'AAPL',
  priority: 'normal',
  refetchInterval: 30000,
})
```

---

## 5) API Stats Monitor

```tsx
// frontend/src/components/ApiStatsMonitor.tsx
<ApiStatsMonitor />
```

---

## 6) News Fetcher with Priority

```ts
// frontend/src/lib/newsApi.ts
const response = await fetch(
  `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/news/${symbol}/finnhub?priority=high&limit=20`
)
```

---

## 7) React Query Integration

```tsx
// frontend/src/hooks/useFinnhubData.ts
useQuery({
  queryKey: ['finnhub-quote', symbol, priority],
  queryFn: async () => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/enhanced/quote/${symbol}/finnhub?priority=${priority}`
    )
    if (!response.ok) throw new Error('Failed to fetch quote')
    return response.json()
  },
  refetchInterval: priority === 'high' ? 5000 : 30000,
  staleTime: priority === 'high' ? 5000 : 30000,
})
```

---

## Best Practices

**Do**
- Use `priority=high` on Research/Markets pages
- Use `priority=normal` on Dashboard/background updates
- Show loading states when high‑priority waits

**Don’t**
- Use `priority=high` everywhere (defeats rate limiting)
- Poll faster than cache TTLs
- Fire duplicate requests for the same symbol

---

## Recommended Refresh Intervals

**Research (high):** Quotes 5s, News 3m  
**Markets (high):** Indices 10s, Trending 30s  
**Dashboard (normal):** Watchlist 30s, News 5m
