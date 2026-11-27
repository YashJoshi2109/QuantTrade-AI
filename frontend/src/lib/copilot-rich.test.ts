import { describe, expect, it } from 'vitest'
import {
  collapseProgress,
  isNumericCell,
  isStructuredAnswer,
  sectionKey,
  splitMarkdownBlocks,
  splitSections,
  withoutSourcesSection,
} from './copilot-rich'

const DEEP = `## Summary
Value is $431.17 [calc:valuation_dcf:MSFT:ab12cd34].

## Data & Method
EV = sum FCFF / (1 + WACC)^t.

## Results
| Metric | Value | Source |
|---|---:|---|
| WACC | 9.12% | [calc:valuation_wacc:MSFT:1] |
| Value per share | $431.17 | [calc:valuation_dcf:MSFT:ab12cd34] |

## Interpretation
Below market.

## Verified facts vs assumptions/interpretation
- Assumption: terminal growth 2.5%.

## Limitations
- Not executed: Monte Carlo simulation (no tool available).

## Sources

1. [calc:valuation_dcf:MSFT:ab12cd34] MSFT DCF — engine; as of 2026-11-24`

describe('splitMarkdownBlocks', () => {
  it('extracts pipe tables with alignment and keeps surrounding markdown', () => {
    const segs = splitMarkdownBlocks('Intro\n\n| A | B |\n|:--|--:|\n| x | 1 |\n| y \\| z | 2 |\n\nAfter')
    expect(segs.map((s) => s.kind)).toEqual(['md', 'table', 'md'])
    const t = segs[1]
    if (t.kind !== 'table') throw new Error('expected table')
    expect(t.header).toEqual(['A', 'B'])
    expect(t.align).toEqual(['left', 'right'])
    expect(t.rows).toEqual([['x', '1'], ['y | z', '2']])
  })

  it('pads short rows and ignores pipes without a separator row', () => {
    const segs = splitMarkdownBlocks('| a | b | c |\n|---|---|---|\n| 1 |\n\nnot | a table')
    const t = segs[0]
    if (t.kind !== 'table') throw new Error('expected table')
    expect(t.rows).toEqual([['1', '', '']])
    expect(segs[1]).toEqual({ kind: 'md', text: '\nnot | a table' })
  })
})

describe('deep answer sections', () => {
  it('classifies the required headings, with numbering and aliases', () => {
    expect(sectionKey('Summary')).toBe('summary')
    expect(sectionKey('2. Data & Method')).toBe('data_method')
    expect(sectionKey('Methodology')).toBe('data_method')
    expect(sectionKey('Verified facts vs assumptions/interpretation')).toBe('facts_vs_assumptions')
    expect(sectionKey('Caveats')).toBe('limitations')
    expect(sectionKey('Something else')).toBe('other')
  })

  it('splits sections and detects the structured shape', () => {
    const s = splitSections(DEEP)
    expect(s.map((x) => x.key)).toEqual(['summary', 'data_method', 'results', 'interpretation', 'facts_vs_assumptions', 'limitations', 'sources'])
    expect(isStructuredAnswer(DEEP)).toBe(true)
    expect(isStructuredAnswer('NVDA is $181.\n\n## Details\nmore')).toBe(false)
  })

  it('drops only the Sources section', () => {
    const out = withoutSourcesSection(DEEP)
    expect(out).not.toContain('## Sources')
    expect(out).toContain('## Limitations\n\n- Not executed: Monte Carlo simulation')
    expect(out).toContain('| WACC | 9.12% |')
    expect(withoutSourcesSection('plain answer')).toBe('plain answer')
  })
})

describe('progress + cells', () => {
  it('keeps the latest status per step, in first-seen order, with the running label', () => {
    const items = collapseProgress([
      { id: 'a', label: 'Running 10,000 simulations for AMZN', status: 'running' },
      { id: 'b', label: 'Fetching 5y statements for AMZN', status: 'running' },
      { id: 'a', label: 'valuation monte carlo', status: 'done' },
    ])
    expect(items).toEqual([
      { id: 'a', label: 'Running 10,000 simulations for AMZN', status: 'done' },
      { id: 'b', label: 'Fetching 5y statements for AMZN', status: 'running' },
    ])
  })

  it('recognises numeric cells (with citations) for right alignment', () => {
    expect(isNumericCell('9.12%')).toBe(true)
    expect(isNumericCell('$3,297,000,000,000')).toBe(true)
    expect(isNumericCell('-0.1583 [calc:x:Y:1]')).toBe(true)
    expect(isNumericCell('1.2x')).toBe(true)
    expect(isNumericCell('Value per share')).toBe(false)
  })
})
