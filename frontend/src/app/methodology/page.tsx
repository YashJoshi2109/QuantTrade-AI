/**
 * /methodology: server-rendered explanation of how each number on the site is
 * produced. Content lives in lib/methodology.ts so llms-full.txt and tests
 * read the same text.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { JsonLd } from '@/components/seo/JsonLd'
import { ROUTE_SEO, routeMetadata } from '@/lib/routeSeo'
import { articleSchema, breadcrumbSchema } from '@/lib/schema'
import { METHODOLOGY_INTRO, METHODOLOGY_REVIEWED, METHODOLOGY_SECTIONS, METHODOLOGY_TITLE } from '@/lib/methodology'

export const metadata: Metadata = routeMetadata('/methodology')

const link = 'text-blue-600 hover:underline dark:text-sky-400'

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export default function MethodologyPage() {
  return (
    <AppLayout>
      <JsonLd
        data={articleSchema({
          path: '/methodology',
          headline: METHODOLOGY_TITLE,
          description: ROUTE_SEO['/methodology'].description,
          dateModified: METHODOLOGY_REVIEWED,
          type: 'TechArticle',
        })}
      />
      <JsonLd data={breadcrumbSchema([{ name: 'Methodology', path: '/methodology' }])} />
      <article className="mx-auto w-full max-w-3xl space-y-4 px-0 py-4 sm:px-4 md:space-y-5 md:px-6 md:py-6">
        <header className="rs-card p-4 md:p-6">
          <nav aria-label="Breadcrumb" className="mb-3 text-[12px] text-fg-muted">
            <Link prefetch={false} href="/" className="hover:underline">Home</Link>
            <span className="mx-2" aria-hidden>/</span>
            <span className="text-fg-secondary">Methodology</span>
          </nav>
          <h1 className="text-2xl font-bold text-fg-primary md:text-3xl">{METHODOLOGY_TITLE}</h1>
          <p className="mt-2 text-[13px] text-fg-muted">
            Last reviewed <time dateTime={METHODOLOGY_REVIEWED}>{formatDate(METHODOLOGY_REVIEWED)}</time>
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-secondary">{METHODOLOGY_INTRO}</p>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-secondary">
            Apply it on the <Link prefetch={false} href="/stocks" className={link}>stock pages</Link>, the{' '}
            <Link prefetch={false} href="/screener" className={link}>screener</Link> and the{' '}
            <Link prefetch={false} href="/backtest" className={link}>backtester</Link>. Terms are defined in the{' '}
            <Link prefetch={false} href="/glossary" className={link}>glossary</Link>, and who builds QuantTrade AI is on the{' '}
            <Link prefetch={false} href="/about" className={link}>about page</Link>.
          </p>
          <nav aria-label="On this page" className="mt-4">
            <ul className="grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2">
              {METHODOLOGY_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={link}>{s.question}</a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {METHODOLOGY_SECTIONS.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="rs-card scroll-mt-24 p-4 md:p-6">
            <h2 id={`${s.id}-h`} className="text-lg font-semibold text-fg-primary md:text-xl">{s.question}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-fg-secondary">{s.passage}</p>
            {s.details?.length ? (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-fg-secondary">
                {s.details.map((d) => <li key={d}>{d}</li>)}
              </ul>
            ) : null}
            {s.sources?.length ? (
              <p className="mt-3 text-[13px] text-fg-muted">
                Sources:{' '}
                {s.sources.map((src, i) => (
                  <span key={src.url}>
                    {i > 0 ? ', ' : ''}
                    <a href={src.url} rel="noopener" className={link}>{src.name}</a>
                  </span>
                ))}
              </p>
            ) : null}
            {s.links?.length ? (
              <p className="mt-2 text-[13px] text-fg-muted">
                See it on:{' '}
                {s.links.map((l, i) => (
                  <span key={l.href}>
                    {i > 0 ? ' · ' : ''}
                    <Link prefetch={false} href={l.href} className={link}>{l.label}</Link>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
        ))}

        <p className="px-1 text-[12px] text-fg-muted">
          Not investment advice. QuantTrade AI is a research tool, not a broker-dealer or registered investment adviser.
          See <Link prefetch={false} href="/legal" className={link}>legal and disclaimers</Link>.
        </p>
      </article>
    </AppLayout>
  )
}
