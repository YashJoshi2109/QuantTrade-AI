---
name: magic
description: >-
  Redesign the desktop dashboard Live News block with a distinctive “magic”
  editorial HUD: amber/teal atmosphere, serif hero, split regional desk vs
  global wire for continent tabs. Invoke when the user says /magic, “magic
  news panel”, or wants the continent news layout refit.
---

# /magic — Dashboard news panel

## When to use

- User types **`/magic`** or asks to **redesign the news panel** on the home dashboard (`HomePageClient` desktop grid).
- Follow **`frontend-design`** in the same turn: commit to a bold direction, avoid generic purple-on-white / Inter-only slop, use layered depth, motion, and intentional typography.

## Product rules

1. **`global` continent tab** — Single merged **live** stream (`mergeGlobalDashboardNews`). No split between “regional desk” and “wire”.
2. **Every other continent tab** — Two streams:
   - **Regional desk**: Guardian-backed columns from `GET /monitor/continent-news`, selected by `continentGuardianFeedKeys` in `frontend/src/lib/dashboard-continent-news.ts` (keys must match backend feed names, e.g. `Asia-Pacific`, `United States`).
   - **Global wire**: `buildWireNewsItems` — live breaking headlines **deduped** against regional items so the same story does not appear twice.
3. **Implementation surface** — Prefer edits in:
   - `frontend/src/components/dashboard/DashboardMagicNewsPanel.tsx`
   - `frontend/src/lib/dashboard-continent-news.ts`
   - `frontend/src/app/HomePageClient.tsx` (data wiring only; keep diffs small).

## Checklist

- [ ] Map UI continents to the correct **Guardian feed keys** (hyphenation and full names matter).
- [ ] Regional hero = first regional item; remaining regional items in a grid; wire list on the side (wide screens) or stacked (narrow).
- [ ] Loading: respect `newsPending` for the whole panel; optional **continent feed** loading state when regional is still empty.
- [ ] Accessibility: links `target="_blank"` + `rel="noopener noreferrer"`; focus rings on interactive cards.
- [ ] Run `npx tsc --noEmit` and `npm run test` in `frontend/` after substantive changes.

## Aesthetic direction (default for this project)

**Magic editorial HUD** — dark slate base, warm amber accent, teal secondary, subtle grain and radial glows, **Instrument Serif** for the hero line, **DM Sans** for metadata. Staggered `framer-motion` reveals on lists. Adjust within this family if the product theme shifts, but keep the **split data model** for non-global tabs.
