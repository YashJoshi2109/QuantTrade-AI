import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PageHeading from './PageHeading'

describe('PageHeading', () => {
  it('renders exactly one <h1> across a desktop + mobile pair', () => {
    const html = renderToStaticMarkup(
      <>
        <div className="hidden md:block">
          <PageHeading className="text-2xl">Earnings calendar</PageHeading>
        </div>
        <div className="md:hidden">
          <PageHeading mobile className="text-lg">Earnings calendar</PageHeading>
        </div>
      </>
    )
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(html).toContain('<p role="heading" aria-level="1" class="text-lg">Earnings calendar</p>')
  })
})
