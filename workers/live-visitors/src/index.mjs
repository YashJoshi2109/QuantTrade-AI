/**
 * QuantTrade Live Visitors Worker
 *
 * Tracks active visitors via heartbeat pings stored in KV with auto-expiry.
 * Frontend sends POST /heartbeat every 30s; backend calls GET /count.
 *
 * KV keys: "v:<session-hash>" → timestamp, TTL 90s (auto-pruned).
 * GET /count lists surviving keys → count = active visitors.
 */

const HEARTBEAT_TTL = 90 // seconds — visitor considered "gone" after this

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

/** Simple string hash → base36 session key */
function sessionHash(ip, ua) {
  const raw = `${ip}|${ua}`
  let h = 0
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0
  }
  return 'v:' + Math.abs(h).toString(36)
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)
    const path = url.pathname

    // ─── POST /heartbeat ─────────────────────────────────────────
    if (path === '/heartbeat' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      const ua = request.headers.get('User-Agent') || ''
      const key = sessionHash(ip, ua)
      const now = Math.floor(Date.now() / 1000)

      await env.VISITORS.put(key, String(now), { expirationTtl: HEARTBEAT_TTL })

      return jsonResponse({ ok: true })
    }

    // ─── GET / or /count ─────────────────────────────────────────
    if ((path === '/' || path === '/count') && request.method === 'GET') {
      // Optional auth check for backend-only access
      const secret = env.API_SECRET || ''
      if (secret) {
        const auth = request.headers.get('Authorization') || ''
        if (!auth.includes(secret)) {
          return jsonResponse({ error: 'unauthorized' }, 401)
        }
      }

      // List all surviving heartbeat keys (KV auto-prunes expired)
      const list = await env.VISITORS.list({ prefix: 'v:' })
      const count = list.keys.length

      return jsonResponse({ count, source: 'cloudflare_worker' })
    }

    return jsonResponse({ error: 'not found' }, 404)
  },
}
