/**
 * /stocks/{SYMBOL}: server-rendered, indexable page per ticker (ISR, 15 min).
 *
 * /research?symbol=X stays the interactive app; this page is the shareable,
 * crawlable summary of the same backend data. Unknown and retired tickers 404.
 */
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import StockPageView from '@/components/stocks/StockPageView'
import { buildDescription, buildFacts, buildFaq, buildJsonLd, buildSections, buildTitle, jsonLdString } from '@/lib/stockPage/content'
import { backendBase, loadStockPage } from '@/lib/stockPage/data'
import { POPULAR_ETFS, PRERENDER_SYMBOLS, sectorPeers, universeEntry } from '@/lib/stockPage/related'
import { parseStockSlug, stockUrl, symbolToSlug } from '@/lib/stockPage/symbol'

export const revalidate = 900
export const dynamicParams = true

type Params = { symbol: string }

/**
 * Pre-render the most viewed tickers only when STOCK_PAGES_PRERENDER=1 and the
 * build can reach the backend (ideally the internal URL: a build fans out ~14
 * requests per ticker). By default (and in the Docker build, which has no
 * backend) every page renders on its first request and is then cached for
 * `revalidate` seconds, so a backend hiccup can never fail a deploy.
 */
export async function generateStaticParams(): Promise<Params[]> {
  if (process.env.STOCK_PAGES_PRERENDER !== '1' || !backendBase()) return []
  return PRERENDER_SYMBOLS.map((s) => ({ symbol: symbolToSlug(s) as string }))
}

// generateMetadata and the page both call this; Next memoizes the identical
// backend fetches within one render, so the backend sees each request once.
const load = (symbol: string) => loadStockPage(symbol)

function resolveSlug(raw: string) {
  const parsed = parseStockSlug(raw)
  if (!parsed) notFound()
  if (parsed.needsRedirect) permanentRedirect(`/stocks/${parsed.slug}`)
  return parsed
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { symbol: raw } = await params
  const parsed = parseStockSlug(raw)
  if (!parsed || parsed.needsRedirect) return {}
  const result = await load(parsed.symbol)
  if (result.kind !== 'ok') return { title: { absolute: 'Page not found · QuantTrade AI' }, robots: { index: false, follow: true } }

  const facts = buildFacts(result.data)
  const title = buildTitle(facts)
  const description = buildDescription(facts)
  const url = stockUrl(facts.symbol) as string
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      siteName: 'QuantTrade AI',
    },
    twitter: { card: 'summary', title, description },
  }
}

export default async function StockPage({ params }: { params: Promise<Params> }) {
  const { symbol: raw } = await params
  const parsed = resolveSlug(raw)
  const result = await load(parsed.symbol)
  if (result.kind !== 'ok') notFound()

  const data = result.data
  const facts = buildFacts(data)
  const sections = buildSections(facts)
  const faq = buildFaq(facts)
  const title = buildTitle(facts)
  const description = buildDescription(facts)
  const dateModified = data.quote?.as_of ?? data.fetchedAt
  const jsonLd = buildJsonLd(facts, { title, description, faq, dateModified })

  const peers = universeEntry(facts.symbol) ? sectorPeers(facts.symbol, 10) : []
  const etfs = POPULAR_ETFS.filter((s) => s !== facts.symbol)
    .map((s) => universeEntry(s))
    .filter((e): e is NonNullable<typeof e> => e !== null)

  return (
    <AppLayout symbol={facts.symbol}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <StockPageView
        facts={facts}
        sections={sections}
        faq={faq}
        bars={data.bars}
        peers={peers}
        etfs={etfs}
        fetchedAt={data.fetchedAt}
      />
    </AppLayout>
  )
}
