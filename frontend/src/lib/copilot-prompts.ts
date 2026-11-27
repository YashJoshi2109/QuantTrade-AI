/**
 * Personalised starter prompts for the copilot empty state (desktop + mobile).
 *
 * Sources, in order of relevance: the ticker the user came from (?symbol=),
 * their watchlist, their portfolio holdings, tickers they recently asked
 * about, then a few evergreen questions.  Each prompt is one readable line,
 * phrased the way a person would ask it, and no ticker appears twice.
 */
import { normalizeSymbol } from './copilot-handoff'

export type PromptSource = 'context' | 'watchlist' | 'portfolio' | 'recent' | 'evergreen'

export interface StarterPrompt {
  id: string
  text: string
  symbol: string | null
  source: PromptSource
}

export interface StarterPromptGroup {
  source: PromptSource
  title: string
  prompts: StarterPrompt[]
}

export interface StarterPromptInput {
  contextSymbol?: string | null
  watchlist?: Array<string | null | undefined>
  /** Holdings, ideally largest weight first. */
  holdings?: Array<string | null | undefined>
  recent?: Array<string | null | undefined>
  /** Cap per personal group (default 2). */
  perGroup?: number
}

const GROUP_TITLES: Record<PromptSource, string> = {
  context: 'About the stock you were viewing',
  watchlist: 'From your watchlist',
  portfolio: 'From your portfolio',
  recent: 'Pick up where you left off',
  evergreen: 'Good places to start',
}

/** Templates rotate per position so two watchlist rows don't read the same. */
const TEMPLATES: Record<Exclude<PromptSource, 'evergreen'>, Array<(t: string) => string>> = {
  context: [
    (t) => `How is ${t} doing, and what is driving it this week?`,
    (t) => `What did ${t} report last quarter?`,
    (t) => `What are the biggest risks in ${t}'s latest 10-K?`,
  ],
  watchlist: [
    (t) => `What moved ${t} this week?`,
    (t) => `How did ${t}'s revenue and margins change last quarter?`,
    (t) => `Is ${t} expensive compared with its peers?`,
  ],
  portfolio: [
    (t) => `What are the main risks for ${t} right now?`,
    (t) => `What's been driving ${t} this month?`,
    (t) => `How has ${t}'s valuation changed over the past year?`,
  ],
  recent: [
    (t) => `What's new with ${t} since I last asked?`,
    (t) => `Summarise the latest news on ${t}.`,
  ],
}

export const EVERGREEN_PROMPTS: string[] = [
  'Which sectors led the market this week, and why?',
  'Compare Apple and Microsoft on growth and profitability.',
  'How do interest rates affect stock valuations?',
  'What does a P/E ratio tell me, and when is it misleading?',
]

function cleanList(list: Array<string | null | undefined> | undefined, seen: Set<string>): string[] {
  const out: string[] = []
  for (const raw of list ?? []) {
    const s = normalizeSymbol(raw ?? null)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** Build grouped starter prompts. Empty personal groups are omitted. */
export function buildStarterPrompts(input: StarterPromptInput): StarterPromptGroup[] {
  const perGroup = Math.max(1, input.perGroup ?? 2)
  const seen = new Set<string>()
  const groups: StarterPromptGroup[] = []

  const ctx = normalizeSymbol(input.contextSymbol ?? null)
  if (ctx) {
    seen.add(ctx)
    groups.push({
      source: 'context',
      title: GROUP_TITLES.context,
      prompts: TEMPLATES.context.slice(0, Math.max(perGroup, 2)).map((tpl, i) => ({
        id: `context-${ctx}-${i}`, text: tpl(ctx), symbol: ctx, source: 'context',
      })),
    })
  }

  const personal: Array<[Exclude<PromptSource, 'evergreen' | 'context'>, string[]]> = [
    ['watchlist', cleanList(input.watchlist, seen)],
    ['portfolio', cleanList(input.holdings, seen)],
    ['recent', cleanList(input.recent, seen)],
  ]
  for (const [source, symbols] of personal) {
    const picked = symbols.slice(0, perGroup)
    if (!picked.length) continue
    const tpls = TEMPLATES[source]
    groups.push({
      source,
      title: GROUP_TITLES[source],
      prompts: picked.map((t, i) => ({ id: `${source}-${t}`, text: tpls[i % tpls.length](t), symbol: t, source })),
    })
  }

  // Fewer evergreen prompts when the user already has personal ones.
  const evergreenCount = groups.length >= 2 ? 2 : groups.length === 1 ? 3 : 4
  groups.push({
    source: 'evergreen',
    title: GROUP_TITLES.evergreen,
    prompts: EVERGREEN_PROMPTS.slice(0, evergreenCount).map((text, i) => ({
      id: `evergreen-${i}`, text, symbol: null, source: 'evergreen',
    })),
  })
  return groups
}

// ─── Recently asked tickers (per browser) ───────────────────────────────────

export const RECENT_TICKERS_KEY = 'qt.copilot.recent'
const RECENT_MAX = 8

/** Pure: put `symbol` first, dedupe, cap. */
export function pushRecent(list: string[], symbol: string | null | undefined, max = RECENT_MAX): string[] {
  const s = normalizeSymbol(symbol ?? null)
  if (!s) return list.slice(0, max)
  return [s, ...list.filter((x) => x !== s)].slice(0, max)
}

export function readRecentTickers(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_TICKERS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function rememberRecentTicker(symbol: string | null | undefined): void {
  try {
    window.localStorage.setItem(RECENT_TICKERS_KEY, JSON.stringify(pushRecent(readRecentTickers(), symbol)))
  } catch {
    /* storage blocked: recents are a convenience only */
  }
}
