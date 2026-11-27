/**
 * Rich copilot answers (desktop + mobile): pipe tables, the structured deep-answer
 * sections, the facts-vs-assumptions callout and the server-rendered Sources list.
 *
 * react-markdown here runs without remark-gfm, so GFM pipe tables are parsed by
 * hand into segments the UI renders as real, horizontally scrollable tables.
 */

export interface MdSegment {
  kind: 'md'
  text: string
}

export interface TableSegment {
  kind: 'table'
  header: string[]
  align: Array<'left' | 'right' | 'center'>
  rows: string[][]
}

export type Segment = MdSegment | TableSegment

const SEP_CELL = /^:?-+:?$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += s[i]
    }
  }
  cells.push(cur.trim())
  return cells
}

function isSeparator(line: string): boolean {
  if (!line.includes('-') || !line.includes('|')) return false
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((c) => SEP_CELL.test(c))
}

function looksLikeRow(line: string): boolean {
  return line.trim().includes('|')
}

/** Split markdown into plain-markdown and table segments (tables need a header + separator row). */
export function splitMarkdownBlocks(md: string): Segment[] {
  const lines = (md || '').split('\n')
  const out: Segment[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length) {
      const text = buf.join('\n')
      if (text.trim()) out.push({ kind: 'md', text })
      buf = []
    }
  }
  let i = 0
  while (i < lines.length) {
    if (looksLikeRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = splitRow(lines[i])
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left',
      ) as TableSegment['align']
      const rows: string[][] = []
      i += 2
      while (i < lines.length && looksLikeRow(lines[i]) && lines[i].trim() !== '') {
        const r = splitRow(lines[i])
        rows.push(header.map((_, k) => r[k] ?? ''))
        i++
      }
      flush()
      out.push({ kind: 'table', header, align, rows })
      continue
    }
    buf.push(lines[i])
    i++
  }
  flush()
  return out
}

// ─── Deep-answer sections ────────────────────────────────────────────────────

export type SectionKey =
  | 'summary'
  | 'data_method'
  | 'results'
  | 'interpretation'
  | 'facts_vs_assumptions'
  | 'limitations'
  | 'sources'
  | 'other'

const SECTION_RX: Array<[Exclude<SectionKey, 'other'>, RegExp]> = [
  ['summary', /^(summary|executive summary|bottom line)$/i],
  ['data_method', /^(data\s*(&|and)\s*method(ology)?|method(ology)?|data\s*(&|and)\s*assumptions)$/i],
  ['results', /^(results?|findings)$/i],
  ['interpretation', /^(interpretation|analysis|discussion)$/i],
  ['facts_vs_assumptions', /^(verified facts.*|facts\s*vs\.?\s*assumptions.*|facts,? assumptions.*)$/i],
  ['limitations', /^(limitations?|caveats)$/i],
  ['sources', /^(sources|citations|references)$/i],
]

export interface AnswerSection {
  key: SectionKey
  title: string | null
  /** Markdown body, without the heading line. */
  body: string
}

export function sectionKey(title: string): SectionKey {
  const t = title.replace(/^\d+[.)]\s*/, '').replace(/\*/g, '').trim()
  return SECTION_RX.find(([, rx]) => rx.test(t))?.[0] ?? 'other'
}

/** Split an answer at `## ` headings. Text before the first heading is an untitled section. */
export function splitSections(md: string): AnswerSection[] {
  const out: AnswerSection[] = []
  const re = /^#{2,3}\s+(.+?)\s*#*\s*$/gm
  let last = 0
  let title: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    const body = md.slice(last, m.index)
    if (title !== null || body.trim()) out.push({ key: title ? sectionKey(title) : 'other', title, body: body.replace(/^\n+/, '') })
    title = m[1].trim()
    last = m.index + m[0].length
  }
  const tail = md.slice(last)
  if (title !== null || tail.trim()) out.push({ key: title ? sectionKey(title) : 'other', title, body: tail.replace(/^\n+/, '') })
  return out
}

/** True for answers in the deep (institutional) structure. */
export function isStructuredAnswer(md: string): boolean {
  const keys = new Set(splitSections(md).map((s) => s.key))
  return keys.has('summary') && keys.has('results') && (keys.has('limitations') || keys.has('facts_vs_assumptions'))
}

/**
 * Drop the server-rendered Sources section when the UI shows the citation
 * ledger (same data, richer). Keeps everything else verbatim.
 */
export function withoutSourcesSection(md: string): string {
  const parts = splitSections(md)
  if (!parts.some((p) => p.key === 'sources')) return md
  return parts
    .filter((p) => p.key !== 'sources')
    .map((p) => (p.title ? `## ${p.title}\n\n${p.body}` : p.body))
    .join('\n\n')
    .trim()
}

/** Latest status per progress id, in first-seen order (a step's running label is kept). */
export function collapseProgress<T extends { id?: string; label: string; status: string }>(items: T[] | undefined): T[] {
  const order: string[] = []
  const last = new Map<string, T>()
  for (const p of items ?? []) {
    const key = p.id ?? p.label
    const prev = last.get(key)
    if (!prev) order.push(key)
    last.set(key, { ...prev, ...p, label: prev && p.status !== 'running' ? prev.label : p.label })
  }
  return order.map((k) => last.get(k) as T)
}

/** Numeric-looking cell (right-align in tables). */
export function isNumericCell(s: string): boolean {
  const t = s.replace(/\[[^\]]*\]\([^)]*\)|\[[a-z]+:[^\]]+\]/g, '').trim()
  return /^[-−+]?\$?[\d,]*\.?\d+(\s?(%|x|×|bps|pp|[KMBT]))?$/.test(t)
}
