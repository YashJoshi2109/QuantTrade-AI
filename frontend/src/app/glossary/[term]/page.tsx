/**
 * /glossary/[term]: one statically generated page per glossary term.
 * Unknown slugs 404 (dynamicParams = false).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import AppLayout from '@/components/AppLayout'
import { JsonLd } from '@/components/seo/JsonLd'
import { pageMetadata } from '@/lib/seo'
import { breadcrumbSchema, definedTermSchema } from '@/lib/schema'
import { GLOSSARY_REVIEWED, GLOSSARY_TERMS, categoryLabel, getTerm, glossaryPath, termTitle } from '@/lib/glossary'

export const dynamicParams = false

type Params = { term: string }

export function generateStaticParams(): Params[] {
  return GLOSSARY_TERMS.map((t) => ({ term: t.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { term } = await params
  const t = getTerm(term)
  if (!t) return {}
  return pageMetadata({ title: termTitle(t.short, Boolean(t.formula)), description: t.summary, path: glossaryPath(t.slug), ogType: 'article' })
}

const link = 'text-blue-600 hover:underline dark:text-sky-400'

export default async function GlossaryTermPage({ params }: { params: Promise<Params> }) {
  const { term } = await params
  const t = getTerm(term)
  if (!t) notFound()
  const related = t.related.map(getTerm).filter((r): r is NonNullable<typeof r> => Boolean(r))

  return (
    <AppLayout>
      <JsonLd data={definedTermSchema(t, GLOSSARY_REVIEWED)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Glossary', path: '/glossary' },
          { name: t.short, path: glossaryPath(t.slug) },
        ])}
      />
      <article className="mx-auto w-full max-w-3xl space-y-4 px-0 py-4 sm:px-4 md:space-y-5 md:px-6 md:py-6">
        <header className="rs-card p-4 md:p-6">
          <nav aria-label="Breadcrumb" className="mb-3 text-[12px] text-fg-muted">
            <Link prefetch={false} href="/" className="hover:underline">Home</Link>
            <span className="mx-2" aria-hidden>/</span>
            <Link prefetch={false} href="/glossary" className="hover:underline">Glossary</Link>
            <span className="mx-2" aria-hidden>/</span>
            <Link prefetch={false} href={`/glossary#${t.category}`} className="hover:underline">{categoryLabel(t.category)}</Link>
          </nav>
          <h1 className="text-2xl font-bold text-fg-primary md:text-3xl">{t.term}</h1>
          <p className="mt-2 text-[13px] text-fg-muted">
            Last reviewed <time dateTime={GLOSSARY_REVIEWED}>{GLOSSARY_REVIEWED}</time>
          </p>
          <p className="mt-3 text-[16px] font-medium leading-relaxed text-fg-primary">{t.summary}</p>
        </header>

        <section aria-labelledby="definition" className="rs-card p-4 md:p-6">
          <h2 id="definition" className="text-lg font-semibold text-fg-primary">What is {t.short}?</h2>
          {t.body.map((p, i) => (
            <p key={i} className="mt-3 text-[15px] leading-relaxed text-fg-secondary">{p}</p>
          ))}
          {t.formula ? (
            <>
              <h3 className="mt-5 text-[15px] font-semibold text-fg-primary">Formula</h3>
              <p className="mt-2 overflow-x-auto rounded-lg border border-line-subtle bg-surface-raised px-3 py-2 font-mono text-[13px] text-fg-primary">
                {t.formula}
              </p>
            </>
          ) : null}
        </section>

        <section aria-labelledby="example" className="rs-card p-4 md:p-6">
          <h2 id="example" className="text-lg font-semibold text-fg-primary">Worked example</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-secondary">{t.example}</p>
        </section>

        <section aria-labelledby="where" className="rs-card p-4 md:p-6">
          <h2 id="where" className="text-lg font-semibold text-fg-primary">Where you&apos;ll see it on QuantTrade</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] text-fg-secondary">
            {t.seeOn.map((l) => (
              <li key={l.href + l.label}>
                <Link prefetch={false} href={l.href} className={link}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </section>

        {related.length ? (
          <section aria-labelledby="related" className="rs-card p-4 md:p-6">
            <h2 id="related" className="text-lg font-semibold text-fg-primary">Related terms</h2>
            <ul className="mt-3 flex flex-wrap gap-2 text-[13px]">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link prefetch={false} href={glossaryPath(r.slug)} className="inline-block rounded-full border border-line-default px-3 py-1 text-fg-secondary hover:bg-surface-hover">
                    {r.short}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="px-1 text-[12px] text-fg-muted">
          Educational definition, not investment advice. How QuantTrade AI calculates its figures is explained in the{' '}
          <Link prefetch={false} href="/methodology" className={link}>methodology</Link>.
        </p>
      </article>
    </AppLayout>
  )
}
