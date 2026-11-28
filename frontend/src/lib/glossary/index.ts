/**
 * Glossary registry: one list of terms (split across files by category for
 * size), category labels, lookups and the review date shown on every page.
 */
import { FUNDAMENTAL_TERMS } from './termsFundamentals'
import { MARKET_TERMS } from './termsMarkets'
import type { GlossaryCategory, GlossaryTerm } from './types'

export type { GlossaryCategory, GlossaryLink, GlossaryTerm } from './types'

/** Visible "Last reviewed" date and sitemap lastmod for every glossary page. */
export const GLOSSARY_REVIEWED = '2026-11-28'

export const GLOSSARY_CATEGORIES: { id: GlossaryCategory; label: string; blurb: string }[] = [
  { id: 'valuation', label: 'Valuation and fundamentals', blurb: 'What a business earns, what it is worth and what the market pays for it.' },
  { id: 'earnings-dividends', label: 'Earnings and dividends', blurb: 'Per-share profit, quarterly reports and cash paid to shareholders.' },
  { id: 'technical', label: 'Technical indicators', blurb: 'Indicators computed from price and volume history.' },
  { id: 'risk-performance', label: 'Risk and performance', blurb: 'How volatile an investment is and how much return it earned for that risk.' },
  { id: 'filings-data', label: 'SEC filings and data', blurb: 'Regulatory filings, ownership disclosures and how data becomes available.' },
  { id: 'backtesting', label: 'Backtesting and research', blurb: 'Testing a strategy on history without fooling yourself.' },
  { id: 'options', label: 'Options and volatility', blurb: 'What option prices say about expected moves and risk.' },
  { id: 'macro-market', label: 'Macro and market structure', blurb: 'Rates, factors, breadth and the trading day itself.' },
]

export const GLOSSARY_TERMS: GlossaryTerm[] = [...FUNDAMENTAL_TERMS, ...MARKET_TERMS]

const BY_SLUG = new Map(GLOSSARY_TERMS.map((t) => [t.slug, t]))

export function getTerm(slug: string): GlossaryTerm | undefined {
  return BY_SLUG.get(slug)
}

export function glossaryPath(slug: string): string {
  return `/glossary/${slug}`
}

export function termsByCategory(): { id: GlossaryCategory; label: string; blurb: string; terms: GlossaryTerm[] }[] {
  return GLOSSARY_CATEGORIES.map((c) => ({
    ...c,
    terms: GLOSSARY_TERMS.filter((t) => t.category === c.id).sort((a, b) => a.short.localeCompare(b.short)),
  })).filter((c) => c.terms.length > 0)
}

export function categoryLabel(id: GlossaryCategory): string {
  return GLOSSARY_CATEGORIES.find((c) => c.id === id)?.label ?? id
}

/** Word count of a term page's own prose (definition, formula, example). */
export function termWordCount(t: GlossaryTerm): number {
  const text = [...t.body, t.formula ?? '', t.example].join(' ')
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Page part of a term page <title>. The root template appends
 * " | QuantTrade AI", so the page part stays within 44 characters.
 */
export function termTitle(short: string, hasFormula = false): string {
  const options = [`${short}: Definition & Example`, `${short}: Definition`]
  if (hasFormula) options.unshift(`${short}: Definition, Formula & Example`)
  for (const t of options) {
    if (t.length <= 44) return t
  }
  return short.slice(0, 44)
}
