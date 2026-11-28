/**
 * /glossary: server-rendered index of every term, grouped by category with
 * anchors. Each term links to its own /glossary/[term] page.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema, definedTermSetSchema } from '@/lib/schema'
import { GLOSSARY_REVIEWED, GLOSSARY_TERMS, glossaryPath, termsByCategory } from '@/lib/glossary'

export const metadata: Metadata = routeMetadata('/glossary')

const link = 'text-blue-600 hover:underline dark:text-sky-400'

export default function GlossaryPage() {
  const groups = termsByCategory()
  return (
    <AppLayout>
      <JsonLd data={definedTermSetSchema(GLOSSARY_TERMS, GLOSSARY_REVIEWED)} />
      <JsonLd data={breadcrumbSchema([{ name: 'Glossary', path: '/glossary' }])} />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-0 py-4 sm:px-4 md:space-y-5 md:px-6 md:py-6">
        <header className="rs-card p-4 md:p-6">
          <nav aria-label="Breadcrumb" className="mb-3 text-[12px] text-fg-muted">
            <Link prefetch={false} href="/" className="hover:underline">Home</Link>
            <span className="mx-2" aria-hidden>/</span>
            <span className="text-fg-secondary">Glossary</span>
          </nav>
          <h1 className="text-2xl font-bold text-fg-primary md:text-3xl">Investing and market data glossary</h1>
          <p className="mt-2 text-[13px] text-fg-muted">
            {GLOSSARY_TERMS.length} terms · Last reviewed <time dateTime={GLOSSARY_REVIEWED}>{GLOSSARY_REVIEWED}</time>
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-secondary">
            Definitions of the ratios, indicators, filings and research terms you will see on QuantTrade AI. Each page
            gives the formula where there is one, a worked example and the places in the app where the number appears.
            How we calculate each figure is explained in the{' '}
            <Link prefetch={false} href="/methodology" className={link}>methodology</Link>.
          </p>
          <nav aria-label="Categories" className="mt-4 flex flex-wrap gap-2 text-[13px]">
            {groups.map((g) => (
              <a key={g.id} href={`#${g.id}`} className="rounded-full border border-line-default px-3 py-1 text-fg-secondary hover:bg-surface-hover">
                {g.label} <span className="text-fg-muted tabular-nums">({g.terms.length})</span>
              </a>
            ))}
          </nav>
        </header>

        {groups.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className="rs-card scroll-mt-24 p-4 md:p-6">
            <h2 id={`${g.id}-h`} className="text-lg font-semibold text-fg-primary">{g.label}</h2>
            <p className="mt-1 text-[13px] text-fg-muted">{g.blurb}</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
              {g.terms.map((t) => (
                <div key={t.slug}>
                  <dt>
                    <Link prefetch={false} href={glossaryPath(t.slug)} className="font-semibold text-fg-primary hover:underline">
                      {t.term}
                    </Link>
                  </dt>
                  <dd className="text-[13px] leading-relaxed text-fg-secondary">{t.summary}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <p className="px-1 text-[12px] text-fg-muted">Educational definitions only. Not investment advice.</p>
      </div>
    </AppLayout>
  )
}
