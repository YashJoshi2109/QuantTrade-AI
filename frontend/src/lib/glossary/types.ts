/**
 * Glossary term shape. Content is original and written for QuantTrade AI;
 * every "seeOn" link must point to a route that exists in frontend/src/app.
 */
export type GlossaryCategory =
  | 'valuation'
  | 'earnings-dividends'
  | 'technical'
  | 'risk-performance'
  | 'filings-data'
  | 'backtesting'
  | 'options'
  | 'macro-market'

export interface GlossaryLink {
  label: string
  href: string
}

export interface GlossaryTerm {
  /** URL slug: lowercase, hyphenated, unique. */
  slug: string
  /** Display name, e.g. "Price-to-earnings ratio (P/E)". */
  term: string
  /** Short name used in links and titles, e.g. "P/E ratio". */
  short: string
  category: GlossaryCategory
  /** One-sentence definition (70-155 chars): meta description and index blurb. */
  summary: string
  /** Definition paragraphs (plain text). */
  body: string[]
  /** Formula in plain text, when the term has one. */
  formula?: string
  /** A worked example with concrete numbers. */
  example: string
  /** Where the term appears in the product. */
  seeOn: GlossaryLink[]
  /** Slugs of related terms (must exist). */
  related: string[]
}
