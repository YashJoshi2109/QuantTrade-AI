import { describe, it, expect, vi, beforeEach } from "vitest";
import workerExport from "./index";

// ── Minimal KV stub ──────────────────────────────────────────────────────────
function makeKv(store: Record<string, string> = {}) {
  return {
    async get(key: string, type?: string) {
      const v = store[key];
      if (v === undefined) return null;
      if (type === "json") return JSON.parse(v);
      return v;
    },
    async put(key: string, value: string, _opts?: unknown) {
      store[key] = value;
    },
    async delete(key: string) { delete store[key]; },
    async list() { return { keys: [], list_complete: true, cursor: "" }; },
    async getWithMetadata(key: string) { return { value: null, metadata: null }; },
  };
}

// ── Minimal ExecutionContext stub ─────────────────────────────────────────────
function makeCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };
}

// ── Helper ───────────────────────────────────────────────────────────────────
function makeReq(path: string, method = "GET") {
  return new Request(`https://worker.example.com${path}`, { method });
}

const ORIGIN = "https://api.example.com";
const AAPL_PREDICTION = { symbol: "AAPL", horizon: 1, direction: "up", confidence: 0.72 };

// ── Tests ────────────────────────────────────────────────────────────────────

describe("OPTIONS (CORS preflight)", () => {
  it("returns 204", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/predict", "OPTIONS"), env as any, makeCtx() as any);
    expect(resp.status).toBe(204);
  });
});

describe("GET /predict — validation", () => {
  it("400 when symbol missing", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/predict?horizon=1"), env as any, makeCtx() as any);
    expect(resp.status).toBe(400);
    const body = await resp.json() as any;
    expect(body.error).toMatch(/symbol/i);
  });

  it("400 when horizon missing", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/predict?symbol=AAPL"), env as any, makeCtx() as any);
    expect(resp.status).toBe(400);
  });

  it("400 when horizon invalid (5)", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/predict?symbol=AAPL&horizon=5"), env as any, makeCtx() as any);
    expect(resp.status).toBe(400);
  });
});

describe("GET /predict — cache hit", () => {
  it("returns cached:true with cached data when KV hit", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const kv = makeKv({ [`prediction:AAPL:1:${today}`]: JSON.stringify(AAPL_PREDICTION) });
    const env = { ML_META: kv, ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/predict?symbol=AAPL&horizon=1"), env as any, makeCtx() as any);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.cached).toBe(true);
    expect(body.symbol).toBe("AAPL");
  });

  it("symbol is uppercased before cache lookup", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Key uses uppercase AAPL — query uses lowercase aapl
    const kv = makeKv({ [`prediction:AAPL:1:${today}`]: JSON.stringify(AAPL_PREDICTION) });
    const env = { ML_META: kv, ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/predict?symbol=aapl&horizon=1"), env as any, makeCtx() as any);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.cached).toBe(true);
  });
});

describe("GET /predict — cache miss (origin fetch)", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it("fetches origin on cache miss, returns cached:false", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(AAPL_PREDICTION), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const resp = await workerExport.fetch(makeReq("/predict?symbol=AAPL&horizon=1"), env as any, makeCtx() as any);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.cached).toBe(false);
  });

  it("returns 502 when origin returns non-2xx (not 404)", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 503 })));
    const resp = await workerExport.fetch(makeReq("/predict?symbol=AAPL&horizon=7"), env as any, makeCtx() as any);
    expect(resp.status).toBe(502);
  });

  it("returns 404 when origin returns 404", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
    const resp = await workerExport.fetch(makeReq("/predict?symbol=AAPL&horizon=30"), env as any, makeCtx() as any);
    expect(resp.status).toBe(404);
  });
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/health"), env as any, makeCtx() as any);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.status).toBe("ok");
  });
});

describe("Unknown routes", () => {
  it("returns 404 for unknown path", async () => {
    const env = { ML_META: makeKv(), ORIGIN_URL: ORIGIN };
    const resp = await workerExport.fetch(makeReq("/unknown"), env as any, makeCtx() as any);
    expect(resp.status).toBe(404);
  });
});
