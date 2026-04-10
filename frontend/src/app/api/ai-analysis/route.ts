import { NextRequest, NextResponse } from 'next/server'

/**
 * OpenRouter AI Analysis endpoint.
 * Uses a free/cheap model (google/gemini-flash-1.5-8b) to produce a concise
 * real-time analysis paragraph based on the indicators passed in the body.
 * Falls back gracefully when OPENROUTER_API_KEY is missing.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_MODEL = 'google/gemini-flash-1.5-8b'

export interface AIAnalysisRequest {
  symbol: string
  price?: number
  change_pct?: number
  rsi?: number
  macd?: number
  macd_signal?: number
  sma_20?: number
  sma_50?: number
  sma_200?: number
  bb_upper?: number
  bb_lower?: number
  bb_middle?: number
  volume?: number
}

export async function POST(req: NextRequest) {
  const body: AIAnalysisRequest = await req.json()
  const { symbol, price, change_pct, rsi, macd, macd_signal, sma_20, sma_50, sma_200, bb_upper, bb_lower, volume } = body

  if (!OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY not configured' },
      { status: 503 },
    )
  }

  const lines: string[] = [`Symbol: ${symbol}`]
  if (price) lines.push(`Price: $${price.toFixed(2)}`)
  if (change_pct !== undefined) lines.push(`Change: ${change_pct >= 0 ? '+' : ''}${change_pct.toFixed(2)}%`)
  if (rsi) lines.push(`RSI(14): ${rsi.toFixed(1)}`)
  if (macd !== undefined && macd_signal !== undefined) lines.push(`MACD: ${macd.toFixed(3)} / Signal: ${macd_signal.toFixed(3)} (${macd > macd_signal ? 'bullish cross' : 'bearish cross'})`)
  if (sma_20) lines.push(`SMA20: $${sma_20.toFixed(2)}${price ? (price > sma_20 ? ' ✓ above' : ' ✗ below') : ''}`)
  if (sma_50) lines.push(`SMA50: $${sma_50.toFixed(2)}${price ? (price > sma_50 ? ' ✓ above' : ' ✗ below') : ''}`)
  if (sma_200) lines.push(`SMA200: $${sma_200.toFixed(2)}${price ? (price > sma_200 ? ' ✓ above' : ' ✗ below') : ''}`)
  if (bb_upper && bb_lower) lines.push(`Bollinger: $${bb_lower.toFixed(2)} – $${bb_upper.toFixed(2)}${price ? ` (price ${((price - bb_lower) / (bb_upper - bb_lower) * 100).toFixed(0)}% of band)` : ''}`)
  if (volume) lines.push(`Volume: ${(volume / 1e6).toFixed(2)}M`)

  const prompt = `You are a concise quantitative analyst. Given these technical indicators for ${symbol}, write 3-4 tight sentences of analysis: what the momentum, trend, and volatility signals suggest. Be specific with numbers. Conclude with a one-word overall stance (Bullish/Bearish/Neutral). Do not add disclaimers.

${lines.join('\n')}`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://quanttrade.us',
      'X-Title': 'QuantTrade AI',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 280,
      temperature: 0.4,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    return NextResponse.json({ error: `OpenRouter error: ${response.status} ${errText}` }, { status: 502 })
  }

  // Forward the SSE stream directly
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader()
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
          if (!trimmed || trimmed === 'data: [DONE]') {
            if (trimmed === 'data: [DONE]') controller.close()
            continue
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(trimmed.slice(6))
              const token = chunk.choices?.[0]?.delta?.content ?? ''
              if (token) controller.enqueue(new TextEncoder().encode(token))
            } catch {
              // skip malformed chunks
            }
          }
        }
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
