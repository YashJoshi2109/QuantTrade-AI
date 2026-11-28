import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/stockPageNVDA.json'
import {
  buildDescription,
  buildFacts,
  buildFaq,
  buildJsonLd,
  buildSections,
  buildTitle,
  DESCRIPTION_MAX,
  fitSentences,
  formatDate,
  jsonLdString,
  shortCompanyName,
  TITLE_MAX,
} from './content'
import type { StockPageData } from './types'

const nvda = fixture as unknown as StockPageData

function clone(patch: Partial<StockPageData> = {}): StockPageData {
  return { ...JSON.parse(JSON.stringify(nvda)), ...patch }
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

describe('shortCompanyName', () => {
  it.each([
    ['NVIDIA Corporation', 'NVIDIA'],
    ['Apple Inc.', 'Apple'],
    ['Alphabet Inc A', 'Alphabet'],
    ['Berkshire Hathaway Inc. Class B', 'Berkshire Hathaway'],
    ['The Coca-Cola Co', 'The Coca-Cola'],
    ['Booking Holdings Inc', 'Booking Holdings'],
    ['SAP SE', 'SAP'],
    ['V', 'V'],
  ])('%s -> %s', (raw, short) => {
    expect(shortCompanyName(raw)).toBe(short)
  })
})

describe('buildTitle', () => {
  it('uses the full pattern when it fits and trims smartly when not', () => {
    const f = buildFacts(nvda)
    const t = buildTitle(f)
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX)
    // the full pattern is 65 characters, "Forecast & Analysis" 62: both too long
    expect(t).toBe('NVIDIA (NVDA) Stock Price & Forecast | QuantTrade AI')
    expect(t).toContain('(NVDA)')
    expect(t.endsWith('| QuantTrade AI')).toBe(true)
  })

  it('keeps the full pattern for a short name', () => {
    const t = buildTitle({ symbol: 'V', shortName: 'Visa', fund: false, target: 300, forecast: null })
    expect(t).toBe('Visa (V) Stock Price, Forecast & AI Analysis | QuantTrade AI')
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX)
  })

  it('drops "Forecast" when there is no analyst target or statistical range', () => {
    const t = buildTitle({ symbol: 'AAPL', shortName: 'Apple', fund: false, target: null, forecast: null })
    expect(t).not.toMatch(/Forecast/)
    expect(t).toBe('Apple (AAPL) Stock Price & AI Analysis | QuantTrade AI')
  })

  it('falls back to the ticker for very long names and labels ETFs', () => {
    const t = buildTitle({ symbol: 'SPY', shortName: 'State Street SPDR S&P 500 ETF Trust', fund: true, target: null, forecast: null })
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(t).toBe('SPY ETF Price & AI Analysis | QuantTrade AI')
  })
})

describe('buildDescription', () => {
  it('states live facts within 160 characters', () => {
    const d = buildDescription(buildFacts(nvda))
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(d).toContain('$150.49')
    expect(d).toContain('Nov 27, 2026')
  })

  it('fitSentences drops trailing sentences first', () => {
    expect(fitSentences(['Aaaa.', 'Bbbb.', 'Cccc.'], 11)).toBe('Aaaa. Bbbb.')
    expect(fitSentences(['x'.repeat(30)], 10).length).toBeLessThanOrEqual(10)
  })
})

describe('buildFacts (NVDA fixture)', () => {
  const f = buildFacts(nvda)

  it('reads the canonical regular-session quote', () => {
    expect(f.price).toBe(150.49)
    expect(f.changePct).toBeCloseTo(0.7971)
    expect(f.sessionDate).toBe('2026-11-27')
    expect(f.extended?.session).toBe('after-hours')
  })

  it('takes analyst consensus from fundamentals', () => {
    expect(f.target).toBeCloseTo(242.43, 1)
    expect(f.recLabel).toBe('Buy')
  })

  it('has no upcoming earnings date when the calendar has none and the provider date is past', () => {
    expect(f.earnings?.nextDate).toBeNull()
    expect(f.earnings?.last?.date).toBe('2026-11-17')
    expect(f.earnings?.last?.actual).toBe(2.68)
  })

  it('keeps an upcoming ex-dividend date', () => {
    expect(f.dividend?.pays).toBe(true)
    expect(f.dividend?.ttmTotal).toBe(0.52)
    expect(f.dividend?.nextExDate).toBe('2026-12-02')
  })

  it('summarises 90-day insider activity and 13F holders', () => {
    expect(f.insiders?.buys).toBe(0)
    expect(f.insiders?.sells).toBe(37)
    expect(f.institutional?.holders).toBe(5698)
    expect(f.institutional?.top[0].filer).toBe('BlackRock, Inc.')
    expect(f.institutional?.top[1].filer).toBe('Vanguard Capital Management LLC')
  })

  it('needs a full year of bars for a 12-month return', () => {
    expect(f.yearReturnPct).toBeNull()
    const bars = Array.from({ length: 252 }, (_, i) => ({
      timestamp: `2025-${String((i % 12) + 1).padStart(2, '0')}-01T05:00:00Z`,
      close: i === 0 ? 100 : 120,
    }))
    const g = buildFacts(clone({ bars }))
    expect(g.yearReturnPct).toBeCloseTo(50.49)
  })

  it('nulls implausible fundamentals instead of showing them', () => {
    const d = clone()
    d.fundamentals = { ...d.fundamentals, week_52_high: 150.49 * 100 }
    expect(buildFacts(d).high52).toBeNull()
  })
})

describe('buildSections', () => {
  it('produces 300+ words of data-driven copy for NVDA', () => {
    const f = buildFacts(nvda)
    const text = buildSections(f).flatMap((s) => s.sentences).join(' ')
    expect(wordCount(text)).toBeGreaterThanOrEqual(300)
    expect(text).toContain('closed at $150.49 on Nov 27, 2026')
    expect(text).toContain('37 sales')
    expect(text).toContain('beating it by 8.5%')
    expect(text).toContain('headquarters in the United States')
    expect(text).toContain('5,698 institutional managers')
    expect(text).toContain('no edge over the ARIMA(0,1,0) random walk')
    expect(text).not.toMatch(/\bwill (rise|fall|reach)\b/i)
    expect(text).not.toMatch(/undefined|NaN|null/)
  })

  it('skips sentences whose data is missing', () => {
    const f = buildFacts(clone({ insiders: null, institutional: null, forecast: null, indicators: null, fundamentals: null }))
    const sections = buildSections(f)
    const ids = sections.map((s) => s.id)
    expect(ids).not.toContain('ownership')
    expect(ids).not.toContain('technicals')
    const text = sections.flatMap((s) => s.sentences).join(' ')
    expect(text).not.toMatch(/market capitalization|P\/E|RSI|13F|price target/)
    expect(text).not.toMatch(/undefined|NaN|null/)
  })
})

describe('buildFaq', () => {
  const faq = buildFaq(buildFacts(nvda))
  const byQ = (q: string) => faq.find((x) => x.q.includes(q))?.a ?? ''

  it('answers the earnings question honestly when no date is confirmed', () => {
    const a = byQ('next earnings date')
    expect(a).toContain('no confirmed upcoming earnings date')
    expect(a).toContain('Nov 17, 2026')
    expect(a).toContain('$2.68')
  })

  it('answers the dividend question with the real numbers', () => {
    const a = byQ('pay a dividend')
    expect(a).toMatch(/^Yes\./)
    expect(a).toContain('$0.520')
    expect(a).toContain('Dec 2, 2026')
  })

  it('labels the forecast as statistics, not a prediction', () => {
    const a = byQ('stock forecast')
    expect(a).toContain('80% range')
    expect(a).toContain('research-grade')
    expect(a).toContain('not financial advice')
  })

  it('omits questions without data', () => {
    const f = buildFacts(clone({ dividends: null, insiders: null, institutional: null }))
    const qs = buildFaq(f).map((x) => x.q)
    expect(qs.some((q) => q.includes('dividend'))).toBe(false)
    expect(qs.some((q) => q.includes('insiders'))).toBe(false)
  })

  it('says No for a non-payer', () => {
    const d = clone()
    d.dividends = { available: true, payments: [], ttm_total: 0, ttm_count: 0 }
    expect(buildFaq(buildFacts(d)).find((x) => x.q.includes('dividend'))?.a).toMatch(/^No\./)
  })
})

describe('buildJsonLd', () => {
  it('emits Breadcrumb, WebPage and an FAQPage that mirrors the visible FAQ', () => {
    const f = buildFacts(nvda)
    const faq = buildFaq(f)
    const ld = buildJsonLd(f, { title: 't', description: 'd', faq, dateModified: '2026-11-27T18:00:00+00:00' })
    const parsed = JSON.parse(jsonLdString(ld))
    const types = parsed['@graph'].map((g: { '@type': string }) => g['@type'])
    expect(types).toEqual(['BreadcrumbList', 'WebPage', 'FAQPage'])
    const page = parsed['@graph'][1]
    expect(page.url).toBe('https://www.quanttrade.us/stocks/NVDA')
    expect(page.dateModified).toBe('2026-11-27T18:00:00+00:00')
    const qa = parsed['@graph'][2].mainEntity
    expect(qa).toHaveLength(faq.length)
    expect(qa[0].acceptedAnswer.text).toBe(faq[0].a)
    expect(JSON.stringify(parsed)).not.toMatch(/aggregateRating|ratingValue/)
  })

  it('escapes markup in the script payload', () => {
    expect(jsonLdString({ a: '</script><b>' })).not.toContain('</script>')
  })
})

describe('formatDate', () => {
  it('reads calendar dates without a timezone shift', () => {
    expect(formatDate('2026-12-02')).toBe('Dec 2, 2026')
    expect(formatDate('2026-11-27T21:59:59+00:00')).toBe('Nov 27, 2026')
    expect(formatDate('garbage')).toBeNull()
  })
})
