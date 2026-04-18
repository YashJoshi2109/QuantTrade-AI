import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CopilotStructuredData } from '@/lib/copilot-engine'
import { InlineStructuredSnapshots } from './copilot-snapshot-cards'

describe('InlineStructuredSnapshots', () => {
  it('renders ticker snapshot heading and symbol when structured data has a symbol', () => {
    const data: CopilotStructuredData = {
      symbol: 'AMZN',
      quote: {
        price: 180.5,
        change: 1,
        change_percent: 1.2,
        volume: 1e7,
        open: 179,
        high: 181,
        low: 178,
        previous_close: 178.5,
      },
    }
    render(<InlineStructuredSnapshots data={data} />)

    expect(screen.getByText(/Ticker snapshot/i)).toBeInTheDocument()
    expect(screen.getByText('AMZN')).toBeInTheDocument()
  })

  it('renders comparison snapshot and two ticker cards when stocks has two entries', () => {
    const data: CopilotStructuredData = {
      symbol: 'AAPL',
      stocks: [
        {
          symbol: 'AAPL',
          quote: {
            price: 190,
            change: 0.5,
            change_percent: 0.5,
            volume: 5e6,
            open: null,
            high: null,
            low: null,
            previous_close: null,
          },
        },
        {
          symbol: 'MSFT',
          quote: {
            price: 410,
            change: -1,
            change_percent: -0.2,
            volume: 3e6,
            open: null,
            high: null,
            low: null,
            previous_close: null,
          },
        },
      ],
    }
    render(<InlineStructuredSnapshots data={data} />)

    expect(screen.getByText(/Comparison snapshot/i)).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
  })

  it('returns empty when no symbol and no multi-stock payload', () => {
    const data = {} as CopilotStructuredData
    const { container } = render(<InlineStructuredSnapshots data={data} />)
    expect(container.firstChild).toBeNull()
  })
})
