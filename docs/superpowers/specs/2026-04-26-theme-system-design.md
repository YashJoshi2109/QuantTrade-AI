# Theme System Design — Dark/Light Toggle
**Date:** 2026-04-26
**Scope:** Full frontend theming — all pages, components, charts, icons, mobile + desktop

---

## Goals

- Production-quality light theme (D+B aesthetic: warm glassmorphism + off-white base)
- Dark/light toggle persisted to localStorage + synced to user profile across devices
- Default theme: **light** for new/logged-out users
- Quant-Agora (/agora/*) toggles with the rest — no split theme
- Toggle visible in: TopNav (all pages), Sidebar (desktop), BottomNav (mobile)
- WCAG AA contrast compliance in both themes
- Zero `dark:` prefix sprawl — semantic tokens only

---

## Architecture: Semantic CSS Variable Tokens

### Approach

All color decisions live in ~30 CSS variables in `globals.css`. Light values in `:root`, dark overrides in `.dark`. Tailwind reads them via `var(--token)`. Components use semantic class names (`bg-surface-raised`, `text-fg-primary`) — one class, works both themes, no `dark:` prefixes.

`next-themes` (already installed, v0.4.6) handles `.dark` class toggling on `<html>`. `ThemeProvider` and `ThemeToggle` components already exist.

### Token Definitions

```css
/* globals.css */

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

  /* ── Shadows (light needs elevation) ── */
  --shadow-sm:    0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md:    0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg:    0 12px 32px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06);
  --shadow-glass: 0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9);

  /* ── Brand ── */
  --accent:       #007AFF;
  --accent-hover: #0066CC;
  --accent-muted: rgba(0, 122, 255, 0.10);

  /* ── Financial data (same both themes) ── */
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
}
```

### Shadow + Glass Utility Classes (globals.css @layer utilities)

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

### Tailwind Registration (tailwind.config.js)

```js
colors: {
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
  // existing: accent, up, down — keep
}
```

---

## Hardcoded Class Migration Map

| Hardcoded (dark) | Semantic token |
|---|---|
| `bg-gray-900`, `bg-zinc-900`, `bg-slate-900` | `bg-surface-base` |
| `bg-gray-800`, `bg-zinc-800`, `bg-slate-800` | `bg-surface-raised` |
| `bg-gray-700`, `bg-zinc-700` | `bg-surface-overlay` |
| `bg-black`, `bg-[#0a0f17]`, `bg-[#111827]` | `bg-surface-base` |
| `text-white`, `text-gray-50`, `text-gray-100` | `text-fg-primary` |
| `text-gray-400`, `text-slate-400` | `text-fg-secondary` |
| `text-gray-500`, `text-gray-600` (used as muted) | `text-fg-muted` |
| `border-gray-700`, `border-zinc-700`, `border-white/10` | `border-line-default` |
| `border-gray-800`, `border-white/5`, `border-white/6` | `border-line-subtle` |
| `hover:bg-gray-800`, `hover:bg-white/5` | `hover:bg-surface-hover` |

---

## Chart Theme System

### Hook: `useThemeTokens`

New file: `frontend/src/hooks/useThemeTokens.ts`

```ts
'use client'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'

function getCSSVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function useThemeTokens() {
  const { resolvedTheme } = useTheme()
  return useMemo(() => ({
    surface:       getCSSVar('--surface-raised'),
    surfaceBase:   getCSSVar('--surface-base'),
    textPrimary:   getCSSVar('--text-primary'),
    textMuted:     getCSSVar('--text-muted'),
    textSecondary: getCSSVar('--text-secondary'),
    borderDefault: getCSSVar('--border-default'),
    borderSubtle:  getCSSVar('--border-subtle'),
    up:            getCSSVar('--up'),
    down:          getCSSVar('--down'),
    accent:        getCSSVar('--accent'),
    tooltipBg:     getCSSVar('--surface-overlay'),
    tooltipBorder: getCSSVar('--border-default'),
    tooltipText:   getCSSVar('--text-primary'),
  }), [resolvedTheme])
}
```

### Recharts Pattern

```tsx
const t = useThemeTokens()

<CartesianGrid stroke={t.borderSubtle} strokeDasharray="3 3" />
<XAxis tick={{ fill: t.textMuted }} axisLine={{ stroke: t.borderDefault }} />
<YAxis tick={{ fill: t.textMuted }} axisLine={{ stroke: t.borderDefault }} />
<Tooltip contentStyle={{
  background: t.tooltipBg,
  border: `1px solid ${t.tooltipBorder}`,
  color: t.textPrimary,
  borderRadius: '8px',
  boxShadow: 'var(--shadow-md)',
}} />
```

**Candlestick/financial colors:** Up `#10b981` / Down `#ef4444` — never change, financial convention.

### Chart files to update
- `src/app/monitor/page.tsx`
- `src/app/markets/page.tsx`
- `src/app/watchlist/page.tsx`
- `src/components/StockSnapshotModal.tsx`
- `src/components/backtest/MarketScanner.tsx`
- `src/components/ui/line-charts-1.tsx`
- `src/components/ui/line-charts-4.tsx`
- `src/components/ui/data-flow-pipes.tsx`
- `src/components/ui/hero-device-assemble.tsx`
- `src/components/monitor/DottedFlatMap.tsx`

---

## Toggle Placement

- **TopNav/Header** — right side before user avatar (new addition)
- **Sidebar** — desktop, already present (keep)
- **BottomNav** — mobile, already present (keep)

`ThemeToggle` component already built — no changes to the component itself.

---

## Theme Persistence

### localStorage (automatic)
`next-themes` handles this. No extra code.

### Backend sync
**New DB column:**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(10) DEFAULT 'light';
```

**New endpoints:**
```
PATCH /api/v1/users/me/preferences   { "theme": "light" | "dark" }
GET   /api/v1/users/me/preferences   → { "theme": "light" }
```

**On login:** fetch preference → `setTheme(prefs.theme)`

**On change:** debounced 1s fire-and-forget PATCH. localStorage is source of truth — backend sync failure is silent.

### ThemeProvider update
```tsx
<NextThemesProvider
  attribute="class"
  defaultTheme="light"      // changed from "dark"
  enableSystem={false}
  disableTransitionOnChange={false}
>
```

---

## Phase Breakdown

| Phase | Work | Days |
|-------|------|------|
| A | Token foundation — globals.css + tailwind.config.js + ThemeProvider default | 1 |
| B | Layout shell — AppSidebar, MobileNav, BottomNav, TopNav, root body | 1 |
| C | Shared components — PostCard, CommentTree, StockSnapshotModal, all ui/* | 3 |
| D | Feature modules — markets, monitor, research, mlops, messaging, agora, game, settings, auth | 4 |
| E | Charts — useThemeTokens hook + all Recharts instances | 2 |
| F | Icons + images — white-on-transparent audit, SVG fills | 1 |
| G | Mobile QA — 375/390/414px, touch targets, contrast | 2 |
| H | Agora Bloomberg light — qa-* tokens applied to /agora/*, gold darkened | 1 |
| I | Backend sync + TopNav toggle — DB column, endpoints, login sync | 1 |
| J | QA + polish — full desktop+mobile sweep both themes, WCAG AA audit, transition timing | 2 |
| **Total** | | **18 days** |

---

## Constraints

- `--up` / `--down` (green/red) must not change between themes — financial convention
- No `dark:` prefixes in migrated files — semantic tokens only
- Transitions: `200ms ease` on `background-color`, `color`, `border-color`
- WCAG AA minimum contrast ratio (4.5:1 text, 3:1 UI elements)
- Quant-Agora Bloomberg gold darkened to `#c49a00` in light mode for contrast (from `#f0b90b`)
- Charts: `useThemeTokens` hook re-memoizes on `resolvedTheme` change — no stale colors
