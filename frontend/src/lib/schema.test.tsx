import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsonLd, serializeJsonLd } from '@/components/seo/JsonLd'
import { PRO_MONTHLY, PRO_YEARLY_TOTAL } from './pricing'
import { breadcrumbSchema, organizationSchema, webAppSchema, websiteSchema } from './schema'

type Offer = {
  name: string
  price: string
  priceCurrency: string
  billingIncrement?: unknown
  priceSpecification?: { price: string; billingDuration: string; priceCurrency: string }
}

describe('JSON-LD', () => {
  it('WebApplication offers match the pricing constants', () => {
    const offers = webAppSchema.offers as Offer[]
    const monthly = offers.find((o) => o.name.startsWith('Pro (monthly'))!
    const yearly = offers.find((o) => o.name.startsWith('Pro (yearly'))!
    expect(Number(monthly.price)).toBe(PRO_MONTHLY)
    expect(Number(monthly.priceSpecification!.price)).toBe(PRO_MONTHLY)
    expect(monthly.priceSpecification!.billingDuration).toBe('P1M')
    expect(Number(yearly.price)).toBe(PRO_YEARLY_TOTAL)
    expect(Number(yearly.priceSpecification!.price)).toBe(PRO_YEARLY_TOTAL)
    expect(yearly.priceSpecification!.billingDuration).toBe('P1Y')
    for (const o of offers) {
      expect(o.billingIncrement).toBeUndefined()
      expect(o.priceCurrency).toBe('USD')
    }
  })

  it('has no ratings or reviews', () => {
    const s = JSON.stringify([organizationSchema, websiteSchema, webAppSchema])
    expect(s).not.toMatch(/aggregateRating|"review"/)
  })

  it('uses the www host everywhere', () => {
    const s = JSON.stringify([organizationSchema, websiteSchema, webAppSchema, breadcrumbSchema([{ name: 'A', path: '/a' }])])
    for (const url of s.match(/https:\/\/[^"]+/g) ?? []) {
      if (url.startsWith('https://schema.org') || url.startsWith('https://github.com')) continue
      expect(url.startsWith('https://www.quanttrade.us')).toBe(true)
    }
  })

  it('breadcrumb starts at Home and numbers positions', () => {
    const b = breadcrumbSchema([{ name: 'Markets', path: '/markets' }, { name: 'Movers', path: '/markets/movers' }])
    expect(b.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, 'Home', 'https://www.quanttrade.us'],
      [2, 'Markets', 'https://www.quanttrade.us/markets'],
      [3, 'Movers', 'https://www.quanttrade.us/markets/movers'],
    ])
  })

  it('escapes "<" so data cannot close the script tag', () => {
    const json = serializeJsonLd({ name: '</script><script>alert(1)</script>' })
    expect(json).not.toContain('<')
    expect(JSON.parse(json).name).toBe('</script><script>alert(1)</script>')
    const html = renderToStaticMarkup(<JsonLd data={{ name: '</script>' }} />)
    expect(html.match(/<\/script>/g)).toHaveLength(1)
  })
})
