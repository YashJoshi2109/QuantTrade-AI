/**
 * Copilot API — GROQ (primary, server-side) + OpenRouter (fallback)
 * GROQ: Ultra-fast Llama 3.3 70B / Llama 3.1 8B via server route
 * OpenRouter: Gemini Flash / Mistral 7B (client-side, free tier)
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_KEY = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? ''

// Model catalog — GROQ models use server-side route, OpenRouter models are client-side
export const COPILOT_MODELS = [
  {
    id: 'groq/llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B',
    provider: 'GROQ',
    context: '128K tokens',
    recommended: true,
    backend: 'groq' as const,
    description: 'Most capable — fast inference via GROQ',
  },
  {
    id: 'groq/llama-3.1-8b-instant',
    label: 'Llama 3.1 8B',
    provider: 'GROQ',
    context: '128K tokens',
    recommended: false,
    backend: 'groq' as const,
    description: 'Ultra-fast responses',
  },
  {
    id: 'groq/mixtral-8x7b-32768',
    label: 'Mixtral 8×7B',
    provider: 'GROQ',
    context: '32K tokens',
    recommended: false,
    backend: 'groq' as const,
    description: 'Great for structured analysis',
  },
  {
    id: 'google/gemini-flash-1.5-8b',
    label: 'Gemini Flash',
    provider: 'Google',
    context: '1M tokens',
    recommended: false,
    backend: 'openrouter' as const,
    description: 'Via OpenRouter — 1M context',
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct:free',
    label: 'Llama 3.1 (OR)',
    provider: 'Meta',
    context: '128K tokens',
    recommended: false,
    backend: 'openrouter' as const,
    description: 'Via OpenRouter — free tier',
  },
  {
    id: 'mistralai/mistral-7b-instruct:free',
    label: 'Mistral 7B',
    provider: 'Mistral AI',
    context: '32K tokens',
    recommended: false,
    backend: 'openrouter' as const,
    description: 'Via OpenRouter — free tier',
  },
] as const

export type CopilotModelId = (typeof COPILOT_MODELS)[number]['id']

export const FINANCIAL_SYSTEM_PROMPT = `You are QuantTrade AI Copilot — a professional financial research assistant built for active traders and investors.

## Your Role
You provide institutional-quality financial analysis. You are direct, data-driven, and precise. You do NOT give generic disclaimers before every sentence — you treat users as sophisticated market participants.

## How You Respond
- Lead with the key insight or answer, then provide supporting analysis
- Use structured formatting: bullet points, tables, numbered steps where appropriate
- For stock analysis: cover price action, fundamentals, sector context, risk factors
- For market questions: include macro context, sector rotation, historical precedents
- Cite timeframes clearly (e.g., "Q4 2024 earnings", "52-week range", "YTD")
- When discussing price targets or moves, always provide the reasoning

## What You Cover
- Individual stock analysis (technicals, fundamentals, catalyst events)
- Sector and industry analysis
- Macro economic trends and their market impact
- Options strategies and derivatives (Greeks, strategies, risk profiles)
- ETF analysis and portfolio construction
- Earnings previews and analysis
- IPO and SPAC analysis
- Global markets and forex
- Commodities and energy markets
- Cryptocurrency market analysis
- Risk management and position sizing

## Formatting Rules
- Use **bold** for ticker symbols, key data points, and important terms
- Use \`code blocks\` for mathematical formulas or specific values
- Use tables for comparisons between multiple securities
- Keep responses concise — aim for signal over noise
- End complex analyses with a "Key Risks" bullet list

## Important Disclaimer
Always include at the very end (in small text via italics): *This is AI-generated analysis for informational purposes only. Not financial advice. Do your own research.*`

export interface CopilotMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface CopilotStreamChunk {
  text: string
  done: boolean
  error?: string
  modelUsed?: string
}

// ─── GROQ Streaming (via server-side route) ────────────────────────────────
async function streamGroqMessage(
  messages: CopilotMessage[],
  modelId: string,
  onChunk: (chunk: CopilotStreamChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  // Strip "groq/" prefix for server payload
  const groqModelId = modelId.replace('groq/', '')

  const response = await fetch('/api/copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: groqModelId,
      messages: [{ role: 'system', content: FINANCIAL_SYSTEM_PROMPT }, ...messages],
      max_tokens: 2048,
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    onChunk({ text: '', done: true, error: `GROQ error: ${response.status} — ${errText}` })
    return
  }

  if (!response.body) {
    onChunk({ text: '', done: true, error: 'No response body from GROQ' })
    return
  }

  const modelUsed = response.headers.get('X-Model-Used') ?? groqModelId
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      try {
        const json = JSON.parse(trimmed.slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          onChunk({ text: delta, done: false, modelUsed })
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  onChunk({ text: '', done: true, modelUsed })
}

// ─── OpenRouter Streaming ──────────────────────────────────────────────────
async function streamOpenRouterMessage(
  messages: CopilotMessage[],
  modelId: string,
  onChunk: (chunk: CopilotStreamChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!OPENROUTER_KEY) {
    onChunk({ text: '', done: true, error: 'OpenRouter API key not configured. Set NEXT_PUBLIC_OPENROUTER_API_KEY.' })
    return
  }

  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: FINANCIAL_SYSTEM_PROMPT },
      ...messages,
    ],
    stream: true,
    max_tokens: 2048,
    temperature: 0.3,
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://quanttrade.us',
      'X-Title': 'QuantTrade AI Copilot',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    onChunk({ text: '', done: true, error: `Model error: ${response.status} — ${errText}` })
    return
  }

  if (!response.body) {
    onChunk({ text: '', done: true, error: 'No response body from model' })
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      try {
        const json = JSON.parse(trimmed.slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          onChunk({ text: delta, done: false, modelUsed: modelId })
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  onChunk({ text: '', done: true, modelUsed: modelId })
}

/**
 * Stream a chat completion — routes to GROQ or OpenRouter based on model backend
 */
export async function streamCopilotMessage(
  messages: CopilotMessage[],
  modelId: CopilotModelId,
  onChunk: (chunk: CopilotStreamChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  const model = COPILOT_MODELS.find((m) => m.id === modelId)
  const backend = model?.backend ?? 'groq'

  try {
    if (backend === 'groq') {
      await streamGroqMessage(messages, modelId, onChunk, signal)
    } else {
      await streamOpenRouterMessage(messages, modelId, onChunk, signal)
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    onChunk({
      text: '',
      done: true,
      error: err instanceof Error ? err.message : 'Connection failed',
    })
  }
}

/**
 * Quick financial question templates for the welcome screen
 */
export const QUICK_PROMPTS = [
  { label: 'Analyze NVDA', prompt: 'Give me a comprehensive analysis of NVDA including current technicals, fundamentals, upcoming catalysts, and near-term price targets.' },
  { label: 'Sector rotation', prompt: 'What are the current sector rotation trends in US equities? Which sectors are seeing inflows and which are seeing outflows, and why?' },
  { label: 'Fed impact', prompt: 'How do current Fed interest rate expectations impact equity valuations, particularly growth stocks vs value stocks? What should I watch?' },
  { label: 'Options strategy', prompt: 'Explain a covered call strategy on a stock I already own. When is it optimal to use this, what are the risks, and how do I calculate the breakeven?' },
  { label: 'Risk management', prompt: 'How should I think about position sizing and portfolio risk management for a concentrated equity portfolio? Give me a practical framework.' },
  { label: 'Global markets', prompt: 'Give me a summary of today\'s global market conditions — US, Europe, Asia — including key indices, notable movers, and any macro themes driving action.' },
]
