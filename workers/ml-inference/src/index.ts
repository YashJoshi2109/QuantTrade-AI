export interface Env {
  ML_META: KVNamespace;
  ORIGIN_URL: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Seconds until 21:00 UTC (US market close). Min 60s. Skips to next weekday if past close. */
function ttlUntilMarketClose(): number {
  const now = new Date();
  const closeToday = new Date(now);
  closeToday.setUTCHours(21, 0, 0, 0);

  let ttl = Math.floor((closeToday.getTime() - now.getTime()) / 1000);
  if (ttl < 60) {
    closeToday.setUTCDate(closeToday.getUTCDate() + 1);
    const day = closeToday.getUTCDay();
    if (day === 0) closeToday.setUTCDate(closeToday.getUTCDate() + 1); // Sun → Mon
    if (day === 6) closeToday.setUTCDate(closeToday.getUTCDate() + 2); // Sat → Mon
    ttl = Math.floor((closeToday.getTime() - now.getTime()) / 1000);
  }
  return Math.max(60, ttl);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/predict" && request.method === "GET") {
      const symbol = url.searchParams.get("symbol")?.toUpperCase();
      const horizonParam = url.searchParams.get("horizon");

      if (!symbol || !horizonParam) {
        return jsonResponse({ error: "symbol and horizon are required" }, 400);
      }

      const horizon = parseInt(horizonParam, 10);
      if (![1, 7, 30].includes(horizon)) {
        return jsonResponse({ error: "horizon must be 1, 7, or 30" }, 400);
      }

      // KV cache lookup
      const today = new Date().toISOString().slice(0, 10);
      const cacheKey = `prediction:${symbol}:${horizon}:${today}`;
      const cached = await env.ML_META.get(cacheKey, "json");
      if (cached !== null) {
        return jsonResponse({ ...(cached as object), cached: true });
      }

      // Model metadata from KV
      const modelMeta = await env.ML_META.get<{
        version: string; avg_da: number; avg_ic: number; promoted_at: string;
      }>(`model:lstm_h${horizon}:production`, "json");

      // Fetch from origin
      const originUrl = `${env.ORIGIN_URL}/api/v1/predictions/${encodeURIComponent(symbol)}?horizon=${horizon}`;
      const originResp = await fetch(originUrl, {
        headers: { "User-Agent": "quanttrade-ml-inference-worker/1.0" },
      });

      if (!originResp.ok) {
        return jsonResponse(
          { error: "prediction unavailable", symbol, horizon },
          originResp.status === 404 ? 404 : 502
        );
      }

      const prediction = await originResp.json() as object;
      const result = {
        ...prediction,
        model_version: modelMeta?.version ?? "unknown",
        avg_da: modelMeta?.avg_da,
        avg_ic: modelMeta?.avg_ic,
        cached: false,
      };

      // Cache with TTL until market close
      const ttl = ttlUntilMarketClose();
      ctx.waitUntil(
        env.ML_META.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl })
      );

      return jsonResponse(result);
    }

    if (url.pathname === "/health") {
      return jsonResponse({ status: "ok", worker: "quanttrade-ml-inference" });
    }

    return jsonResponse({ error: "not found" }, 404);
  },
};
