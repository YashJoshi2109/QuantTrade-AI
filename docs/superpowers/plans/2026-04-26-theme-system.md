# Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-quality dark/light theme toggle using semantic CSS variables — every page, component, chart, and icon works in both themes with a single class toggle on `<html>`.

**Architecture:** 30 semantic CSS variables defined in `globals.css` (`:root` = light, `.dark` = dark). Tailwind reads them via custom color groups (`surface`, `fg`, `line`). `next-themes` (already installed) handles `.dark` toggling. 169 files migrated from hardcoded dark classes to semantic tokens. Recharts instances use a `useThemeTokens()` hook that reads CSS vars at runtime. Theme preference persists in localStorage (automatic) and syncs to user profile on login.

**Tech Stack:** Next.js 14, Tailwind CSS v3, next-themes v0.4.6, Recharts v3, lucide-react, FastAPI backend

**Design spec:** `docs/superpowers/specs/2026-04-26-theme-system-design.md`

---

## Migration Reference (use in every task)

**Class substitution table — hardcoded dark → semantic token:**

| Hardcoded (dark) | Replace with |
|---|---|
| `bg-gray-900`, `bg-zinc-900`, `bg-slate-900`, `bg-[#0a0f17]`, `bg-[#111827]` | `bg-surface-base` |
| `bg-gray-800`, `bg-zinc-800`, `bg-slate-800`, `bg-[#1f2937]` | `bg-surface-raised` |
| `bg-gray-700`, `bg-zinc-700`, `bg-[#374151]` | `bg-surface-overlay` |
| `bg-black` (used as page bg) | `bg-surface-base` |
| `text-white`, `text-gray-50`, `text-gray-100`, `text-slate-100` | `text-fg-primary` |
| `text-gray-300`, `text-slate-300` | `text-fg-secondary` |
| `text-gray-400`, `text-slate-400`, `text-gray-500` (muted context) | `text-fg-muted` |
| `border-gray-700`, `border-zinc-700`, `border-white/10`, `border-slate-700` | `border-line-default` |
| `border-gray-800`, `border-zinc-800`, `border-white/5`, `border-white/6` | `border-line-subtle` |
| `hover:bg-gray-800`, `hover:bg-white/5`, `hover:bg-zinc-800` | `hover:bg-surface-hover` |
| `bg-white/5`, `bg-white/10` (card overlays) | `bg-surface-hover` |
| `divide-gray-800`, `divide-zinc-800` | `divide-line-subtle` |

**New utility classes (defined in Task 1, use freely after):**
- `.glass-card` — frosted glass card (bg + blur + border + shadow)
- `.shadow-theme-sm`, `.shadow-theme-md`, `.shadow-theme-lg`, `.shadow-theme-glass`

**Build check command (run after every task):**
```bash
cd frontend && npm run build 2>&1 | tail -20
```

---

## Phase A — Token Foundation

### Task 1: CSS Variables + Tailwind Registration

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/tailwind.config.js`

- [ ] **Step 1: Add semantic CSS variables to globals.css**

Open `frontend/src/app/globals.css`. Find the existing `:root { ... }` block. **Replace the entire `:root` block** (keep everything after it) with:

```css
:root {
  /* ── Surfaces (warm off-white + frosted glass) ── */
  --surface-base:         #f7f6f3;
  --surface-raised:       #ffffff;
  --surface-overlay:      #ffffff;
  --surface-glass:        rgba(255, 255, 255, 0.72);
  --surface-glass-border: rgba(0, 0, 0, 0.06);
  --surface-hover:        rgba(0, 0, 0, 0.035);
  --surface-active:       rgba(0, 122, 255, 0.06);

  /* ── Typography ── */
  --text-primary:   #0f172a;
  --text-secondary: #475569;
  --text-muted:     #94a3b8;
  --text-inverted:  #ffffff;

  /* ── Borders ── */
  --border-subtle:  rgba(0, 0, 0, 0.06);
  --border-default: rgba(0, 0, 0, 0.10);
  --border-strong:  rgba(0, 0, 0, 0.18);

  /* ── Shadows ── */
  --shadow-sm:    0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md:    0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg:    0 12px 32px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06);
  --shadow-glass: 0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9);

  /* ── Brand ── */
  --accent:       #007AFF;
  --accent-hover: #0066CC;
  --accent-muted: rgba(0, 122, 255, 0.10);

  /* ── Financial data (invariant across themes) ── */
  --up:      #10b981;
  --down:    #ef4444;
  --neutral: #64748b;

  /* ── Quant-Agora Bloomberg (light variant) ── */
  --qa-bg:     #fefdf8;
  --qa-accent: #c49a00;
  --qa-border: rgba(196, 154, 0, 0.20);

  /* ── Glass blur ── */
  --blur-glass:  20px;
  --blur-strong: 36px;

  /* legacy — keep for backward compat during migration */
  --foreground-rgb: 15, 23, 42;
  --background-start-rgb: 247, 246, 243;
  --background-end-rgb: 247, 246, 243;
  --accent-blue: #007AFF;
  --accent-brand: #007AFF;
  --accent-green: #10b981;
  --accent-red: #ef4444;
}

.dark {
  /* ── Surfaces ── */
  --surface-base:         #0a0f17;
  --surface-raised:       #111827;
  --surface-overlay:      #1a2035;
  --surface-glass:        rgba(8, 12, 28, 0.62);
  --surface-glass-border: rgba(255, 255, 255, 0.07);
  --surface-hover:        rgba(255, 255, 255, 0.04);
  --surface-active:       rgba(0, 122, 255, 0.12);

  /* ── Typography ── */
  --text-primary:   #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted:     #64748b;
  --text-inverted:  #0f172a;

  /* ── Borders ── */
  --border-subtle:  rgba(255, 255, 255, 0.05);
  --border-default: rgba(255, 255, 255, 0.08);
  --border-strong:  rgba(255, 255, 255, 0.14);

  /* ── Shadows ── */
  --shadow-sm:    0 1px 3px rgba(0,0,0,0.4);
  --shadow-md:    0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg:    0 12px 32px rgba(0,0,0,0.6);
  --shadow-glass: 0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);

  /* ── Quant-Agora Bloomberg (original dark) ── */
  --qa-bg:     #0a0a0f;
  --qa-accent: #f0b90b;
  --qa-border: rgba(240, 185, 11, 0.20);

  /* legacy overrides */
  --foreground-rgb: 241, 245, 249;
  --background-start-rgb: 10, 15, 23;
  --background-end-rgb: 10, 15, 23;
  --bg-primary: #0a0f17;
  --bg-secondary: #111827;
  --bg-card: #0D1117;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --border-subtle: rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.12);
}
```

Also add to `globals.css` **inside** `@layer utilities`:

```css
@layer utilities {
  .shadow-theme-sm    { box-shadow: var(--shadow-sm); }
  .shadow-theme-md    { box-shadow: var(--shadow-md); }
  .shadow-theme-lg    { box-shadow: var(--shadow-lg); }
  .shadow-theme-glass { box-shadow: var(--shadow-glass); }

  .glass-card {
    background: var(--surface-glass);
    backdrop-filter: blur(var(--blur-glass));
    -webkit-backdrop-filter: blur(var(--blur-glass));
    border: 1px solid var(--surface-glass-border);
    box-shadow: var(--shadow-glass);
  }
}
```

Also update the `body` rule to use CSS vars:
```css
body {
  background-color: var(--surface-base);
  color: var(--text-primary);
  transition: background-color 200ms ease, color 200ms ease;
}
```

- [ ] **Step 2: Register semantic colors in tailwind.config.js**

Open `frontend/tailwind.config.js`. Inside `theme.extend.colors`, **add** these groups (keep all existing entries):

```js
surface: {
  base:    'var(--surface-base)',
  raised:  'var(--surface-raised)',
  overlay: 'var(--surface-overlay)',
  glass:   'var(--surface-glass)',
  hover:   'var(--surface-hover)',
  active:  'var(--surface-active)',
},
fg: {
  primary:   'var(--text-primary)',
  secondary: 'var(--text-secondary)',
  muted:     'var(--text-muted)',
  inverted:  'var(--text-inverted)',
},
line: {
  subtle:  'var(--border-subtle)',
  default: 'var(--border-default)',
  strong:  'var(--border-strong)',
},
```

- [ ] **Step 3: Verify build passes**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully` (or similar). If type errors appear, fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css frontend/tailwind.config.js
git commit -m "feat(theme): semantic CSS variable tokens + Tailwind color groups"
```

---

### Task 2: ThemeProvider Default + Global Transition

**Files:**
- Modify: `frontend/src/components/ThemeProvider.tsx`
- Modify: `frontend/src/app/globals.css`

- [ ] **Step 1: Change default theme to light**

Open `frontend/src/components/ThemeProvider.tsx`. Change `defaultTheme="dark"` to `defaultTheme="light"`:

```tsx
'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  )
}
```

- [ ] **Step 2: Add smooth theme transition to globals.css**

In `globals.css`, add a global transition rule **before** the `body` rule so color changes animate smoothly:

```css
*, *::before, *::after {
  transition-property: background-color, border-color, color, fill, stroke;
  transition-duration: 200ms;
  transition-timing-function: ease;
}

/* Disable transition on interactive elements to prevent flicker */
button, a, input, textarea, select {
  transition-property: background-color, border-color, color, opacity, transform, box-shadow;
  transition-duration: 150ms;
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ThemeProvider.tsx frontend/src/app/globals.css
git commit -m "feat(theme): default to light, add 200ms theme transition"
```

---

## Phase B — Layout Shell

### Task 3: Sidebar + Header Migration

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/Header.tsx`
- Modify: `frontend/src/components/AppLayout.tsx`

- [ ] **Step 1: Read all three files**

Read each file to understand current classes before editing. Note every `bg-gray-*`, `bg-zinc-*`, `bg-slate-*`, `bg-black`, `text-white`, `text-gray-*`, `border-*` class.

- [ ] **Step 2: Migrate Sidebar.tsx**

Apply the migration map to every hardcoded dark class. Key patterns:
- Sidebar container: replace `bg-gray-900`/`bg-zinc-900`/`bg-black` → `bg-surface-raised`
- Nav item text: `text-gray-400` → `text-fg-secondary`, `text-white` → `text-fg-primary`
- Active nav item: `bg-gray-800`/`bg-white/10` → `bg-surface-active text-accent`
- Hover states: `hover:bg-gray-800`/`hover:bg-white/5` → `hover:bg-surface-hover`
- Borders: `border-gray-800`/`border-white/5` → `border-line-subtle`
- Add `shadow-theme-md` on sidebar container (light mode needs elevation)

- [ ] **Step 3: Migrate Header.tsx**

Apply same migration map. In Header.tsx, also add `ThemeToggle` to the right side of the header nav:

```tsx
import ThemeToggle from '@/components/ui/theme-toggle'

// Inside the header right section (before notifications/avatar):
<ThemeToggle />
```

- [ ] **Step 4: Migrate AppLayout.tsx**

Replace page background classes:
- `bg-gray-900`/`bg-black`/`bg-[#0a0f17]` → `bg-surface-base`
- Any wrapper `text-white` → `text-fg-primary`

- [ ] **Step 5: Build check**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/Header.tsx frontend/src/components/AppLayout.tsx
git commit -m "feat(theme): migrate Sidebar, Header (+ ThemeToggle), AppLayout to semantic tokens"
```

---

### Task 4: Mobile Layout Shell

**Files:**
- Modify: `frontend/src/components/layout/BottomNav.tsx`
- Modify: `frontend/src/components/layout/MobileLayout.tsx`
- Modify: `frontend/src/components/layout/MoreMenu.tsx`

- [ ] **Step 1: Read all three files**

Note every hardcoded dark class.

- [ ] **Step 2: Migrate BottomNav.tsx**

Key patterns:
- Bottom bar background: `bg-gray-900`/`bg-zinc-900`/`bg-black` → `bg-surface-raised`
- Add `border-t border-line-subtle shadow-theme-lg` on the container
- Active icon: `text-white`/`text-blue-400` → `text-accent`
- Inactive icon: `text-gray-500`/`text-gray-400` → `text-fg-muted`
- Backdrop: remove or set `backdrop-blur-md bg-surface-raised/80`

- [ ] **Step 3: Migrate MobileLayout.tsx + MoreMenu.tsx**

Apply migration map. `MoreMenu` overlay: `bg-gray-900` → `bg-surface-raised shadow-theme-lg`.

- [ ] **Step 4: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/components/layout/BottomNav.tsx frontend/src/components/layout/MobileLayout.tsx frontend/src/components/layout/MoreMenu.tsx
git commit -m "feat(theme): migrate mobile layout shell to semantic tokens"
```

---

## Phase C — Shared Components

### Task 5: shadcn/ui Base Components

**Files:**
- Modify: `frontend/src/components/ui/button.tsx`
- Modify: `frontend/src/components/ui/card.tsx`
- Modify: `frontend/src/components/ui/input.tsx`
- Modify: `frontend/src/components/ui/badge-2.tsx`
- Modify: `frontend/src/components/ui/dropdown-menu.tsx`
- Modify: `frontend/src/components/ui/sheet.tsx`
- Modify: `frontend/src/components/ui/skeleton.tsx`
- Modify: `frontend/src/components/ui/scroll-area.tsx`
- Modify: `frontend/src/components/ui/separator.tsx`

- [ ] **Step 1: Read each file, apply migration map**

For each file, find and replace all hardcoded dark classes using the migration table at the top of this plan.

**button.tsx** — key patterns:
- Default variant: `bg-gray-800 hover:bg-gray-700 text-white` → `bg-surface-raised hover:bg-surface-hover text-fg-primary border border-line-default shadow-theme-sm`
- Ghost variant: `hover:bg-white/5` → `hover:bg-surface-hover`

**card.tsx** — key patterns:
- `bg-gray-900`/`bg-zinc-900` → `bg-surface-raised`
- `border-gray-800`/`border-white/10` → `border-line-subtle`
- Add `shadow-theme-sm` to base card

**input.tsx** — key patterns:
- `bg-gray-800` → `bg-surface-raised`
- `border-gray-700` → `border-line-default`
- `text-white` → `text-fg-primary`
- `placeholder:text-gray-500` → `placeholder:text-fg-muted`
- Focus ring: `focus:ring-blue-500`/`focus:border-blue-500` → keep (accent color is same)

**dropdown-menu.tsx** — key patterns:
- Content bg: `bg-gray-900`/`bg-zinc-900` → `bg-surface-overlay shadow-theme-lg`
- Item hover: `hover:bg-gray-800` → `hover:bg-surface-hover`
- Separator: `bg-gray-800` → `bg-line-subtle`

**skeleton.tsx**: `bg-gray-800 animate-pulse` → `bg-surface-hover animate-pulse`

- [ ] **Step 2: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/components/ui/
git commit -m "feat(theme): migrate shadcn ui base components to semantic tokens"
```

---

### Task 6: Community + Post Components

**Files:**
- Modify: `frontend/src/components/community/PostCard.tsx`
- Modify: `frontend/src/components/community/CommentTree.tsx`
- Modify: `frontend/src/components/community/CommentComposer.tsx`
- Modify: `frontend/src/components/community/CommunitySidebar.tsx`
- Modify: `frontend/src/components/community/TrendingSidebar.tsx`
- Modify: `frontend/src/components/community/NotificationBell.tsx`
- Modify: `frontend/src/components/community/Skeletons.tsx`
- Modify: `frontend/src/components/community/EmptyStates.tsx`
- Modify: `frontend/src/components/community/ReportModal.tsx`

- [ ] **Step 1: Read PostCard.tsx and apply migration**

PostCard is the most complex. Key patterns:
- Card wrapper: `bg-gray-900`/`bg-zinc-900` → `bg-surface-raised border border-line-subtle shadow-theme-sm rounded-xl`
- Post body text: `text-gray-300`/`text-gray-200` → `text-fg-secondary`
- Author/metadata: `text-gray-500`/`text-gray-400` → `text-fg-muted`
- Vote buttons: `text-gray-400 hover:text-white` → `text-fg-muted hover:text-fg-primary`
- Dividers: `border-gray-800` → `border-line-subtle`
- Agent post gold border: `border-l-2 border-[#f0b90b]` → `border-l-2 border-[var(--qa-accent)]`

- [ ] **Step 2: Migrate remaining community components**

Apply migration map to each. CommentTree follows same pattern as PostCard (card → `bg-surface-raised`, text → `text-fg-*`, borders → `border-line-*`).

- [ ] **Step 3: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/components/community/
git commit -m "feat(theme): migrate community/post components to semantic tokens"
```

---

### Task 7: Core Modal + Widget Components

**Files:**
- Modify: `frontend/src/components/StockSnapshotModal.tsx`
- Modify: `frontend/src/components/TechnicalAnalysisGauge.tsx`
- Modify: `frontend/src/components/StockVisual.tsx`
- Modify: `frontend/src/components/SiteFooter.tsx`
- Modify: `frontend/src/components/Toast.tsx`
- Modify: `frontend/src/components/SymbolSearch.tsx`
- Modify: `frontend/src/components/MarketTicker.tsx`

- [ ] **Step 1: Read each file + apply migration map**

**StockSnapshotModal.tsx** — key patterns:
- Modal overlay: `bg-black/80` → `bg-black/60 dark:bg-black/80` (dimmer in light)
- Modal panel: `bg-gray-900`/`bg-zinc-900` → `bg-surface-raised shadow-theme-lg`
- Tab active: `bg-gray-800` → `bg-surface-active`

**SiteFooter.tsx**:
- `bg-gray-900`/`bg-black` → `bg-surface-raised border-t border-line-subtle`
- All text → appropriate `text-fg-*` tokens

**Toast.tsx**:
- `bg-gray-800` → `bg-surface-overlay shadow-theme-md`
- Success/error toasts: keep green/red, just fix background

**MarketTicker.tsx**:
- Ticker bar background: `bg-gray-900`/`bg-black` → `bg-surface-raised border-b border-line-subtle`

- [ ] **Step 2: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/components/StockSnapshotModal.tsx frontend/src/components/TechnicalAnalysisGauge.tsx frontend/src/components/StockVisual.tsx frontend/src/components/SiteFooter.tsx frontend/src/components/Toast.tsx frontend/src/components/SymbolSearch.tsx frontend/src/components/MarketTicker.tsx
git commit -m "feat(theme): migrate modal + widget components to semantic tokens"
```

---

## Phase D — Feature Module Pages

### Task 8: Markets + Watchlist Pages

**Files:**
- Modify: `frontend/src/app/markets/page.tsx`
- Modify: `frontend/src/app/markets/layout.tsx`
- Modify: `frontend/src/app/watchlist/page.tsx`
- Modify: `frontend/src/components/MarketMoversPanel.tsx`
- Modify: `frontend/src/components/MarketHeatmap.tsx`
- Modify: `frontend/src/components/MoversHeatmap.tsx`
- Modify: `frontend/src/components/MarketNewsGrid.tsx`
- Modify: `frontend/src/components/FinnhubPanels.tsx`

- [ ] **Step 1: Read + migrate all files**

Apply migration map. Each panel component follows the same pattern:
- Panel wrapper: `bg-gray-900` → `bg-surface-raised border border-line-subtle rounded-xl shadow-theme-sm`
- Panel header: `text-white font-semibold` → `text-fg-primary font-semibold`
- Subtext: `text-gray-400` → `text-fg-muted`
- Table rows: `hover:bg-gray-800` → `hover:bg-surface-hover`
- Table header: `bg-gray-800 text-gray-400` → `bg-surface-hover text-fg-muted`
- Heatmap cells: keep existing color logic (greens/reds), only change neutral bg → `bg-surface-raised`

- [ ] **Step 2: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/app/markets/ frontend/src/app/watchlist/page.tsx frontend/src/components/MarketMoversPanel.tsx frontend/src/components/MarketHeatmap.tsx frontend/src/components/MoversHeatmap.tsx frontend/src/components/MarketNewsGrid.tsx frontend/src/components/FinnhubPanels.tsx
git commit -m "feat(theme): migrate markets + watchlist pages to semantic tokens"
```

---

### Task 9: Monitor Page (20 Panels)

**Files:**
- Modify: `frontend/src/app/monitor/page.tsx`
- Modify: `frontend/src/app/monitor/layout.tsx`
- Modify: `frontend/src/components/monitor/` (all 15 panel files)
- Modify: `frontend/src/components/MiniWorldMonitorSnapshot.tsx`
- Modify: `frontend/src/components/GlobalMonitorGlobe.tsx`
- Modify: `frontend/src/components/GlobalMonitorRightColumn.tsx`

- [ ] **Step 1: List monitor panel files**

```bash
ls /Users/yash/Downloads/QuantTrade-AI/frontend/src/components/monitor/
```

Read each file. There are 15 panels — apply migration map to each.

- [ ] **Step 2: Migrate monitor/page.tsx + layout.tsx**

Page-level: `bg-gray-900`/`bg-black` → `bg-surface-base`. Grid/flex wrappers: replace dark backgrounds.

- [ ] **Step 3: Migrate each panel in components/monitor/**

Each panel follows the same pattern:
- Panel container: `bg-gray-900`/`bg-zinc-900`/`bg-[#0d1117]` → `bg-surface-raised border border-line-subtle rounded-xl shadow-theme-sm`
- Panel title: `text-white`/`text-gray-100` → `text-fg-primary`
- Body text: `text-gray-300`/`text-gray-400` → `text-fg-secondary`/`text-fg-muted`
- Sub-labels: `text-gray-500` → `text-fg-muted`
- Status badges: keep color logic (red/green/amber), only fix bg wrapper
- Inline borders: `border-gray-800`/`border-white/10` → `border-line-subtle`

- [ ] **Step 4: Migrate globe + snapshot components**

`GlobalMonitorGlobe.tsx` — globe background and overlay panels.
`MiniWorldMonitorSnapshot.tsx` — card wrapper → `glass-card`.

- [ ] **Step 5: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/app/monitor/ frontend/src/components/monitor/ frontend/src/components/MiniWorldMonitorSnapshot.tsx frontend/src/components/GlobalMonitorGlobe.tsx frontend/src/components/GlobalMonitorRightColumn.tsx
git commit -m "feat(theme): migrate monitor page + 15 panels to semantic tokens"
```

---

### Task 10: Research + MLOps + Backtest Pages

**Files:**
- Modify: `frontend/src/app/research/page.tsx`
- Modify: `frontend/src/app/research/layout.tsx`
- Modify: `frontend/src/app/mlops/page.tsx`
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/app/backtest/layout.tsx`
- Modify: `frontend/src/components/BacktestPanel.tsx`
- Modify: `frontend/src/components/FundamentalsPanel.tsx`
- Modify: `frontend/src/components/IndicatorsPanel.tsx`
- Modify: `frontend/src/components/KeyFactorsPanel.tsx`
- Modify: `frontend/src/components/KeyStatistics.tsx`
- Modify: `frontend/src/components/backtest/` (all files)

- [ ] **Step 1: Read + migrate all files**

Apply migration map. Panels follow same pattern as Task 9. For backtest results tables:
- Table bg: `bg-gray-900` → `bg-surface-raised`
- Row stripe: `bg-gray-800/50` → `bg-surface-hover/50`
- Positive P&L: keep `text-green-400`/`text-emerald-400` (financial convention)
- Negative P&L: keep `text-red-400`/`text-red-500`

- [ ] **Step 2: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/app/research/ frontend/src/app/mlops/ frontend/src/app/backtest/ frontend/src/components/BacktestPanel.tsx frontend/src/components/FundamentalsPanel.tsx frontend/src/components/IndicatorsPanel.tsx frontend/src/components/KeyFactorsPanel.tsx frontend/src/components/KeyStatistics.tsx frontend/src/components/backtest/
git commit -m "feat(theme): migrate research + mlops + backtest pages to semantic tokens"
```

---

### Task 11: Messaging + Notifications + Copilot Pages

**Files:**
- Modify: `frontend/src/app/community/page.tsx`
- Modify: `frontend/src/app/notifications/page.tsx`
- Modify: `frontend/src/app/copilot/page.tsx`
- Modify: `frontend/src/app/copilot/layout.tsx`
- Modify: `frontend/src/components/CopilotPanel.tsx`
- Modify: `frontend/src/components/UnifiedNotificationCenter.tsx`
- Modify: `frontend/src/components/layout/MobileCommunity.tsx`
- Modify: `frontend/src/components/layout/MobileCommunityMessages.tsx`

- [ ] **Step 1: Read + migrate all files**

Messaging/chat patterns:
- Message bubble (own): keep brand blue bg
- Message bubble (other): `bg-gray-800` → `bg-surface-hover`
- Chat container: `bg-gray-900` → `bg-surface-base`
- Input row: `bg-gray-800` → `bg-surface-raised border-t border-line-subtle`

- [ ] **Step 2: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/app/community/ frontend/src/app/notifications/ frontend/src/app/copilot/ frontend/src/components/CopilotPanel.tsx frontend/src/components/UnifiedNotificationCenter.tsx frontend/src/components/layout/MobileCommunity.tsx frontend/src/components/layout/MobileCommunityMessages.tsx
git commit -m "feat(theme): migrate messaging + notifications + copilot to semantic tokens"
```

---

### Task 12: Homepage + Auth + Settings + Misc Pages

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/HomePageClient.tsx`
- Modify: `frontend/src/app/auth/page.tsx`
- Modify: `frontend/src/app/settings/page.tsx`
- Modify: `frontend/src/app/settings/profile/page.tsx`
- Modify: `frontend/src/app/pricing/PricingClient.tsx`
- Modify: `frontend/src/app/pricing/page.tsx`
- Modify: `frontend/src/app/about/page.tsx`
- Modify: `frontend/src/app/game/page.tsx`
- Modify: `frontend/src/app/ideas-lab/IdeasClient.tsx`
- Modify: `frontend/src/app/connect/page.tsx`
- Modify: `frontend/src/app/help/page.tsx`
- Modify: `frontend/src/app/legal/page.tsx`
- Modify: `frontend/src/app/terms/page.tsx`

- [ ] **Step 1: Migrate auth page**

Login/signup card: `bg-gray-900` → `bg-surface-raised shadow-theme-lg`. Form inputs follow `input.tsx` pattern (already migrated in Task 5).

- [ ] **Step 2: Migrate settings pages**

Settings panels: `bg-gray-900` → `bg-surface-raised border border-line-subtle`. Section headers: `text-gray-400 uppercase text-xs` → `text-fg-muted uppercase text-xs`.

- [ ] **Step 3: Migrate pricing + about + misc**

Hero sections: page bg → `bg-surface-base`. Cards → `bg-surface-raised shadow-theme-md`. CTA buttons: keep brand blue.

- [ ] **Step 4: Migrate game page**

Game panels: `bg-gray-900` → `bg-surface-raised`. Game status bars: keep colored (health = green, etc). Inventory cards → `bg-surface-raised border border-line-subtle`.

- [ ] **Step 5: Migrate homepage**

Hero gradient: adjust for light — replace dark gradient bg with light version. Keep brand accents.

- [ ] **Step 6: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/app/page.tsx frontend/src/app/HomePageClient.tsx frontend/src/app/auth/ frontend/src/app/settings/ frontend/src/app/pricing/ frontend/src/app/about/ frontend/src/app/game/ frontend/src/app/ideas-lab/ frontend/src/app/connect/ frontend/src/app/help/ frontend/src/app/legal/ frontend/src/app/terms/
git commit -m "feat(theme): migrate homepage + auth + settings + misc pages to semantic tokens"
```

---

## Phase E — Charts

### Task 13: useThemeTokens Hook

**Files:**
- Create: `frontend/src/hooks/useThemeTokens.ts`

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useThemeTokens.ts
'use client'

import { useTheme } from 'next-themes'
import { useMemo } from 'react'

function getCSSVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export interface ThemeTokens {
  surface: string
  surfaceBase: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  borderDefault: string
  borderSubtle: string
  up: string
  down: string
  accent: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
}

export function useThemeTokens(): ThemeTokens {
  const { resolvedTheme } = useTheme()

  return useMemo(() => ({
    surface:       getCSSVar('--surface-raised'),
    surfaceBase:   getCSSVar('--surface-base'),
    textPrimary:   getCSSVar('--text-primary'),
    textSecondary: getCSSVar('--text-secondary'),
    textMuted:     getCSSVar('--text-muted'),
    borderDefault: getCSSVar('--border-default'),
    borderSubtle:  getCSSVar('--border-subtle'),
    up:            getCSSVar('--up'),
    down:          getCSSVar('--down'),
    accent:        getCSSVar('--accent'),
    tooltipBg:     getCSSVar('--surface-overlay'),
    tooltipBorder: getCSSVar('--border-default'),
    tooltipText:   getCSSVar('--text-primary'),
  }), [resolvedTheme]) // re-reads CSS vars when theme changes
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useThemeTokens.ts
git commit -m "feat(theme): add useThemeTokens hook for Recharts theme awareness"
```

---

### Task 14: Migrate All Recharts Instances

**Files:**
- Modify: `frontend/src/app/monitor/page.tsx`
- Modify: `frontend/src/app/markets/page.tsx`
- Modify: `frontend/src/app/watchlist/page.tsx`
- Modify: `frontend/src/components/StockSnapshotModal.tsx`
- Modify: `frontend/src/components/backtest/MarketScanner.tsx`
- Modify: `frontend/src/components/ui/line-charts-1.tsx`
- Modify: `frontend/src/components/ui/line-charts-4.tsx`
- Modify: `frontend/src/components/ui/data-flow-pipes.tsx`
- Modify: `frontend/src/components/ui/hero-device-assemble.tsx`
- Modify: `frontend/src/components/monitor/DottedFlatMap.tsx`

- [ ] **Step 1: Apply this pattern to every Recharts component in each file**

In every file that uses Recharts, add the hook and replace all hardcoded colors:

```tsx
import { useThemeTokens } from '@/hooks/useThemeTokens'

// Inside the component:
const t = useThemeTokens()

// Replace all instances:
// stroke="#374151" → stroke={t.borderSubtle}
// stroke="#1f2937" → stroke={t.borderDefault}
// fill="#9ca3af"   → fill={t.textMuted}
// fill="#6b7280"   → fill={t.textMuted}
// fill="#e5e7eb"   → fill={t.textSecondary}

// CartesianGrid:
<CartesianGrid stroke={t.borderSubtle} strokeDasharray="3 3" />

// XAxis + YAxis:
<XAxis tick={{ fill: t.textMuted, fontSize: 12 }} axisLine={{ stroke: t.borderDefault }} tickLine={false} />
<YAxis tick={{ fill: t.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} />

// Tooltip:
<Tooltip
  contentStyle={{
    background: t.tooltipBg,
    border: `1px solid ${t.tooltipBorder}`,
    borderRadius: '8px',
    color: t.textPrimary,
    boxShadow: 'var(--shadow-md)',
    fontSize: '12px',
  }}
  labelStyle={{ color: t.textSecondary }}
/>

// Legend:
<Legend wrapperStyle={{ color: t.textSecondary, fontSize: '12px' }} />

// Area/Line fill — financial lines keep brand colors, only change neutral fills:
// background fill="#1f2937" → fill={t.surfaceBase}
```

**DO NOT change:** `stroke="#10b981"` (green), `stroke="#ef4444"` (red), `fill="#10b981"`, `fill="#ef4444"` — financial convention, must stay.

- [ ] **Step 2: Build check**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -10
```

Fix any TypeScript errors (usually missing `'use client'` directive when adding hook).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/monitor/page.tsx frontend/src/app/markets/page.tsx frontend/src/app/watchlist/page.tsx frontend/src/components/StockSnapshotModal.tsx frontend/src/components/backtest/MarketScanner.tsx frontend/src/components/ui/line-charts-1.tsx frontend/src/components/ui/line-charts-4.tsx frontend/src/components/ui/data-flow-pipes.tsx frontend/src/components/ui/hero-device-assemble.tsx frontend/src/components/monitor/DottedFlatMap.tsx
git commit -m "feat(theme): migrate all Recharts instances to useThemeTokens"
```

---

## Phase F — Icons

### Task 15: Icon Color Audit + Fix

**Files:**
- Modify: any file with `text-white` on icon-only elements (found by grep below)

- [ ] **Step 1: Find icon-only white text**

```bash
grep -rn "text-white" /Users/yash/Downloads/QuantTrade-AI/frontend/src --include="*.tsx" | grep -i "icon\|svg\|lucide\|<[A-Z][a-z]*Icon" | head -30
```

- [ ] **Step 2: Fix icon colors**

For each match: if the icon sits on a colored (non-white) background (e.g., inside a blue button), `text-white` is correct — leave it. If it sits on a neutral background (card, panel, sidebar), change to `text-fg-primary` or `text-fg-muted`.

Pattern:
```tsx
// Navigation icons (inactive): text-gray-400 → text-fg-muted
// Navigation icons (active): text-white on colored bg → keep text-white
// Info/action icons on card: text-white → text-fg-secondary
// Decorative icons: text-gray-500 → text-fg-muted
```

- [ ] **Step 3: Find fill-white SVGs**

```bash
grep -rn "fill=\"white\"\|fill=\"#fff\"\|fill=\"#ffffff\"" /Users/yash/Downloads/QuantTrade-AI/frontend/src --include="*.tsx" | head -20
```

For any inline SVG with `fill="white"` on a neutral (non-colored) background: change to `fill="currentColor"` and set `text-fg-primary` on the parent.

- [ ] **Step 4: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add -p  # stage only changed icon files
git commit -m "feat(theme): fix white-on-transparent icons for light mode"
```

---

## Phase G — Remaining Mobile Components

### Task 16: All Mobile Layout Components

**Files:**
- Modify: `frontend/src/components/layout/MobileMarkets.tsx`
- Modify: `frontend/src/components/layout/MobileDashboard.tsx`
- Modify: `frontend/src/components/layout/MobileMLOps.tsx`
- Modify: `frontend/src/components/layout/MobileResearch.tsx`
- Modify: `frontend/src/components/layout/MobileBacktest.tsx`
- Modify: `frontend/src/components/layout/MobileWatchlist.tsx`
- Modify: `frontend/src/components/layout/MobileSettings.tsx`
- Modify: `frontend/src/components/layout/MobileIdeasLab.tsx`
- Modify: `frontend/src/components/layout/MobileHelp.tsx`
- Modify: `frontend/src/components/layout/MobileLegal.tsx`
- Modify: `frontend/src/components/layout/MobilePricing.tsx`

- [ ] **Step 1: Read + migrate all mobile layout files**

Apply the migration map to every file. Mobile-specific patterns:
- Safe-area backgrounds: `bg-gray-900` → `bg-surface-base`
- Mobile card panels: `bg-gray-800`/`bg-zinc-800` → `bg-surface-raised`
- Pull-to-refresh indicators: keep as-is (not color-sensitive)
- Tab bar (if rendered inside these): → same as BottomNav pattern from Task 4

- [ ] **Step 2: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/components/layout/Mobile*.tsx
git commit -m "feat(theme): migrate all mobile layout components to semantic tokens"
```

---

## Phase H — Quant-Agora Bloomberg Light

### Task 17: Agora Bloomberg Light Variant

**Files:**
- Modify: `frontend/src/app/community/page.tsx` (and any `/agora/*` pages if renamed)
- Modify: `frontend/src/components/community/PostCard.tsx`
- Modify: `frontend/src/components/agora/AgentBadge.tsx` (if exists)
- Modify: `frontend/src/components/agora/ProvenanceDrawer.tsx` (if exists)

- [ ] **Step 1: Apply qa-* tokens to Agora-specific UI**

In Agora/community pages and agent components, replace Bloomberg-specific hardcoded colors:
```tsx
// Page background (Agora-specific override):
// bg-[#0a0a0f] → bg-[var(--qa-bg)]

// Bloomberg gold accent:
// text-[#f0b90b] → text-[var(--qa-accent)]
// border-[#f0b90b] → border-[var(--qa-border)]
// bg-[#f0b90b] → bg-[var(--qa-accent)]

// Agent badge gold border:
// border-l-2 border-[#f0b90b] → border-l-2 border-[var(--qa-accent)]
```

In light mode: `--qa-accent` = `#c49a00` (darker gold for readable contrast on `#fefdf8`).
In dark mode: `--qa-accent` = `#f0b90b` (original Bloomberg gold).

- [ ] **Step 2: Build check + commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -5
git add frontend/src/app/community/ frontend/src/components/community/ frontend/src/components/agora/
git commit -m "feat(theme): Agora Bloomberg light — qa-* token migration"
```

---

## Phase I — Backend Theme Persistence

### Task 18: Backend — theme_preference Column + Endpoints

**Files:**
- Create: `backend/alembic/versions/xxxx_add_theme_preference.py`
- Modify: `backend/app/models/user.py` (or wherever the User model lives)
- Modify: `backend/app/api/users.py` (or profile endpoint file)

- [ ] **Step 1: Find User model and profile API file**

```bash
grep -rn "class User" /Users/yash/Downloads/QuantTrade-AI/backend/app/models/ --include="*.py"
grep -rn "me/preferences\|user.*preference\|GET.*me" /Users/yash/Downloads/QuantTrade-AI/backend/app/api/ --include="*.py" | head -10
```

- [ ] **Step 2: Create Alembic migration**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend && alembic revision --autogenerate -m "add_theme_preference_to_users"
```

Edit the generated file to ensure it contains:

```python
def upgrade():
    op.add_column(
        'users',
        sa.Column('theme_preference', sa.String(10), nullable=True, server_default='light')
    )

def downgrade():
    op.drop_column('users', 'theme_preference')
```

- [ ] **Step 3: Add column to User SQLAlchemy model**

Find the User model file and add:
```python
theme_preference: Mapped[str] = mapped_column(String(10), default="light", nullable=True)
```

- [ ] **Step 4: Add endpoints to users/profile API**

Find the file that handles `/api/v1/users/me` or similar. Add:

```python
from pydantic import BaseModel
from typing import Literal

class UserPreferencesUpdate(BaseModel):
    theme: Literal["light", "dark"]

class UserPreferencesResponse(BaseModel):
    theme: str

@router.patch("/me/preferences")
async def update_user_preferences(
    body: UserPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(User).filter(User.id == current_user.id).update(
        {"theme_preference": body.theme}
    )
    db.commit()
    return {"theme": body.theme}

@router.get("/me/preferences", response_model=UserPreferencesResponse)
async def get_user_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"theme": current_user.theme_preference or "light"}
```

- [ ] **Step 5: Run migration**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend && alembic upgrade head
```

Expected: `Running upgrade ... -> ..., add_theme_preference_to_users`

- [ ] **Step 6: Smoke test endpoints**

```bash
# get token first (replace with valid JWT)
TOKEN="<your-jwt>"
curl -s -X GET http://localhost:8000/api/v1/users/me/preferences \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# expected: {"theme": "light"}

curl -s -X PATCH http://localhost:8000/api/v1/users/me/preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"theme": "dark"}' | python3 -m json.tool
# expected: {"theme": "dark"}
```

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/ backend/app/models/ backend/app/api/
git commit -m "feat(theme): theme_preference column + GET/PATCH /me/preferences endpoints"
```

---

### Task 19: Frontend — Login Sync + Live Sync

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Modify: `frontend/src/components/ThemeProvider.tsx` (or create wrapper)
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add API functions**

In `frontend/src/lib/api.ts`, add:

```typescript
export async function getUserPreferences(): Promise<{ theme: string }> {
  const res = await fetch(`${API_BASE}/api/v1/users/me/preferences`, {
    headers: { Authorization: `Bearer ${getStoredToken()}` },
  })
  if (!res.ok) throw new Error('Failed to fetch preferences')
  return res.json()
}

export async function updateUserPreferences(theme: 'light' | 'dark'): Promise<void> {
  await fetch(`${API_BASE}/api/v1/users/me/preferences`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getStoredToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ theme }),
  })
}
```

Check `api.ts` for the correct function name to get the stored token (e.g., `getStoredToken`, `getToken`, or reading from localStorage directly). Use whatever pattern already exists.

- [ ] **Step 2: Sync theme on login**

In `frontend/src/contexts/AuthContext.tsx`, find the login success handler. After the JWT is stored, add:

```typescript
import { getUserPreferences } from '@/lib/api'
import { useTheme } from 'next-themes'

// Inside the component:
const { setTheme } = useTheme()

// In the login success handler, after storing the token:
try {
  const prefs = await getUserPreferences()
  if (prefs?.theme) setTheme(prefs.theme)
} catch {
  // silent — localStorage preference is source of truth
}
```

- [ ] **Step 3: Sync theme changes to backend**

Create `frontend/src/components/ThemeSyncProvider.tsx`:

```tsx
'use client'

import { useTheme } from 'next-themes'
import { useEffect, useRef } from 'react'
import { updateUserPreferences } from '@/lib/api'

export function ThemeSyncProvider({ isLoggedIn }: { isLoggedIn: boolean }) {
  const { theme } = useTheme()
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!theme || !isLoggedIn) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      updateUserPreferences(theme as 'light' | 'dark').catch(() => {})
    }, 1000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [theme, isLoggedIn])

  return null
}
```

Add `<ThemeSyncProvider isLoggedIn={!!user} />` inside `AuthProvider` or the root layout where `user` is accessible.

- [ ] **Step 4: Build check**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/lib/api.ts frontend/src/components/ThemeSyncProvider.tsx
git commit -m "feat(theme): sync theme preference on login + debounced backend save"
```

---

## Phase J — QA + Polish

### Task 20: Remaining Components + Final Sweep

**Files:**
- Modify: any file still using hardcoded dark classes (find via grep)

- [ ] **Step 1: Find remaining hardcoded dark classes**

```bash
grep -rn "bg-gray-9\|bg-zinc-9\|bg-slate-9\|bg-black\b\|bg-\[#0a0f\|bg-\[#111827\|bg-\[#0d1117\|bg-\[#1f2937" \
  /Users/yash/Downloads/QuantTrade-AI/frontend/src --include="*.tsx" | grep -v "node_modules" | grep -v ".next"
```

- [ ] **Step 2: For each remaining file, apply migration map**

Apply the same substitution table from the top of this plan.

- [ ] **Step 3: Find remaining hardcoded white text**

```bash
grep -rn "text-white\b" /Users/yash/Downloads/QuantTrade-AI/frontend/src --include="*.tsx" | grep -v "node_modules"
```

For each: if on colored bg (blue button, green badge) → keep. If on neutral bg → change to `text-fg-primary`.

- [ ] **Step 4: Final build check**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run build 2>&1
```

Must be zero errors and zero warnings about undefined color classes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(theme): final sweep — remaining hardcoded dark classes"
```

---

### Task 21: WCAG Contrast + Transition Polish

**Files:**
- Modify: `frontend/src/app/globals.css` (if any token values need adjustment)

- [ ] **Step 1: Check contrast ratios manually**

Verify these combinations in light mode (use browser DevTools → Accessibility panel or https://webaim.org/resources/contrastchecker/):

| Foreground | Background | Required | Check |
|---|---|---|---|
| `--text-primary` `#0f172a` | `--surface-base` `#f7f6f3` | 4.5:1 | ✓ (~15:1) |
| `--text-secondary` `#475569` | `--surface-raised` `#ffffff` | 4.5:1 | ✓ (~7:1) |
| `--text-muted` `#94a3b8` | `--surface-raised` `#ffffff` | 3:1 (UI) | ✓ (~3.1:1) |
| `--accent` `#007AFF` | `--surface-base` `#f7f6f3` | 3:1 (UI) | ✓ (~4.5:1) |
| `--qa-accent` `#c49a00` | `--qa-bg` `#fefdf8` | 3:1 (UI) | verify |

If any fail, adjust the CSS var value in `:root` to pass.

- [ ] **Step 2: Verify transition smoothness**

Start the dev server:
```bash
cd /Users/yash/Downloads/QuantTrade-AI/frontend && npm run dev
```

Open `http://localhost:3000`. Click the ThemeToggle in the header. Verify:
- Background transitions smoothly (200ms, no flash)
- No FOUC (flash of unstyled content) on page load
- Charts re-render with correct colors after toggle
- All text remains readable in both modes

If FOUC occurs on load, add to `<html>` in `layout.tsx`:
```tsx
// In the <html> tag, next-themes adds the class server-side:
<html lang="en" suppressHydrationWarning>
```
`suppressHydrationWarning` should already be there (next-themes requirement). If not, add it.

- [ ] **Step 3: Mobile viewport check**

In browser DevTools, switch to mobile (375px iPhone SE, 390px iPhone 14, 414px iPhone Pro Max). Verify:
- BottomNav readable in both themes
- Cards not clipping or overflowing
- ThemeToggle in TopNav accessible (not hidden behind overflow)

- [ ] **Step 4: Final commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat(theme): WCAG contrast + transition polish"
```

---

## Verification Checklist

After all tasks complete, verify:

1. **Toggle works:** Click ThemeToggle in header → entire page switches instantly (200ms)
2. **Default is light:** Open incognito window → site loads in light mode
3. **Charts update:** Monitor page → toggle → Recharts grid/axes/tooltips update immediately
4. **Agora gold:** `/community` page → Bloomberg gold readable in both themes
5. **Mobile:** BottomNav, mobile cards all themed correctly
6. **Login sync:** Log in → theme loads from user profile preference
7. **Change persists:** Toggle dark → reload → still dark (localStorage)
8. **Backend sync:** Toggle → wait 1s → check `GET /api/v1/users/me/preferences` → matches current theme
9. **No FOUC:** Hard refresh → no flash from dark to light on initial load
10. **Recharts no stale colors:** After theme toggle, all chart lines/grids re-read CSS vars
11. **Zero dark:prefix sprawl:** `grep -r "dark:" frontend/src --include="*.tsx" | grep -v "// "` → should return only the ThemeToggle component (the only legitimate use)
