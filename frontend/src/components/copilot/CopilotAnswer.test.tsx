import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CitationData } from '@/lib/copilot-engine'
import { classifyCopilotError } from '@/lib/copilot-trust'
import { AssistantAnswer, LimitNoticeCard, type CopilotMessageView } from './CopilotAnswer'
import CopilotComposer from './CopilotComposer'

afterEach(cleanup)

const NOW = Date.parse('2026-11-26T15:00:00Z')
const citations: CitationData[] = [
  { id: 'quote:NVDA', n: 1, kind: 'quote', source: 'Finnhub', label: 'NVDA quote', as_of: new Date(NOW - 4 * 60_000).toISOString() },
  { id: 'news:9', n: 2, kind: 'news', source: 'Reuters', label: 'Reuters', title: 'Old headline', publisher: 'Reuters', published_at: new Date(NOW - 10 * 86_400_000).toISOString() },
]
const base: CopilotMessageView = {
  id: 'a1',
  role: 'assistant',
  timestamp: new Date(NOW),
  content: `NVDA is $181 [quote:NVDA].\n\n## Details\n${'- A long supporting point about demand and margins that keeps going.\n'.repeat(6)}\n*Informational only, not financial advice.*`,
  citations,
  done: { request_id: 'r', conversation_id: 'c', citations, postcheck: { unverified_numbers: ['40%'] } },
}

describe('AssistantAnswer', () => {
  it('shows a short answer first and the details behind a toggle', () => {
    render(<AssistantAnswer msg={base} now={NOW} onCitationClick={() => {}} />)
    const toggle = screen.getByRole('button', { name: /show details/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /hide details/i }).getAttribute('aria-expanded')).toBe('true')
  })

  it('shows sources with freshness, flags stale and unverified data, and the disclaimer once', () => {
    render(<AssistantAnswer msg={base} now={NOW} onCitationClick={() => {}} />)
    expect(screen.getByText('2 sources cited')).toBeTruthy()
    expect(screen.getByText('1 older source')).toBeTruthy()
    expect(screen.getByText('1 figure not matched to a source')).toBeTruthy()
    expect(screen.getByText('4 min ago')).toBeTruthy()
    expect(screen.getByText(/News is more than a week old/)).toBeTruthy()
    expect(screen.getAllByText(/not financial advice/i)).toHaveLength(1)
  })

  it('opens a source from the inline chip', () => {
    const onCite = vi.fn()
    render(<AssistantAnswer msg={base} now={NOW} onCitationClick={onCite} />)
    fireEvent.click(screen.getByRole('button', { name: /^Source 1: Quote/ }))
    expect(onCite).toHaveBeenCalledWith(citations[0])
  })

  it('styles a risky request as a supportive note, not an error', () => {
    render(<AssistantAnswer msg={{ ...base, content: 'Please be careful.', citations: [], done: null, tone: 'supportive' }} now={NOW} onCitationClick={() => {}} />)
    expect(screen.getByText(/A careful note/)).toBeTruthy()
    expect(screen.getByText('No market data cited in this answer')).toBeTruthy()
  })

  it('offers regenerate and follow-ups on the last answer', () => {
    const onRegen = vi.fn()
    const onAsk = vi.fn()
    render(<AssistantAnswer msg={base} now={NOW} isLast followUps={['What next?']} onCitationClick={() => {}} onRegenerate={onRegen} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    fireEvent.click(screen.getByRole('button', { name: 'What next?' }))
    expect(onRegen).toHaveBeenCalled()
    expect(onAsk).toHaveBeenCalledWith('What next?')
  })
})

describe('LimitNoticeCard', () => {
  it('explains the daily limit with the reset time', () => {
    render(<LimitNoticeCard notice={classifyCopilotError(429, 'Daily AI token limit reached.')} now={NOW} noticeAt={NOW} resetsInSeconds={8 * 3600 + 49 * 60} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText("You've used today's AI allowance")).toBeTruthy()
    expect(screen.getByText(/resets in 8h 49m/)).toBeTruthy()
  })

  it('counts down a per-minute pause before allowing a retry', () => {
    const notice = classifyCopilotError(429, 'Too many AI requests. Please wait a minute and try again.', '60')
    const { rerender } = render(<LimitNoticeCard notice={notice} now={NOW + 20_000} noticeAt={NOW} resetsInSeconds={null} onRetry={() => {}} />)
    expect(screen.getByText('Ready in about 40s.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ask again' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<LimitNoticeCard notice={notice} now={NOW + 61_000} noticeAt={NOW} resetsInSeconds={null} onRetry={() => {}} />)
    expect((screen.getByRole('button', { name: 'Ask again' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('CopilotComposer keyboard', () => {
  it('Enter sends, Shift+Enter does not, Esc stops while streaming', () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    const { rerender } = render(<CopilotComposer value="How is AAPL?" onChange={() => {}} onSend={onSend} onStop={onStop} streaming={false} />)
    const box = screen.getByLabelText('Ask Copilot a question')
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    rerender(<CopilotComposer value="" onChange={() => {}} onSend={onSend} onStop={onStop} streaming />)
    fireEvent.keyDown(screen.getByLabelText('Ask Copilot a question'), { key: 'Escape' })
    expect(onStop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('does not send while the allowance is used up, and says why', () => {
    const onSend = vi.fn()
    render(<CopilotComposer value="hi" onChange={() => {}} onSend={onSend} onStop={() => {}} streaming={false} blocked blockedReason="Resets in 8h 49m." />)
    fireEvent.keyDown(screen.getByLabelText('Ask Copilot a question'), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText('Resets in 8h 49m.')).toBeTruthy()
  })
})
