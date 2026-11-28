import { buildLlmsFull } from '@/lib/llmsFull'

/** /llms-full.txt, rendered once at build time from the page content modules. */
export const dynamic = 'force-static'

export function GET() {
  return new Response(buildLlmsFull(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
