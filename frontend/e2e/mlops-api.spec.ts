import { test, expect } from '@playwright/test'

test.describe('MLOps API Integration', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(90_000)

  test.beforeAll(async ({ request }) => {
    // Warm up the mlops route so connection/middleware init costs hit beforeAll, not the test
    const baseURL = process.env.BACKEND_URL || 'http://localhost:8000'
    await request.get(`${baseURL}/api/v1/mlops/overview`, { timeout: 60_000 }).catch(() => {})
  })

  test('mlops overview endpoint responds', async ({ request }) => {
    const baseURL = process.env.BACKEND_URL || 'http://localhost:8000'
    const response = await request.get(`${baseURL}/api/v1/mlops/overview`, { timeout: 55_000 })
    // 401 = auth required — means the route is reachable
    expect([200, 401, 403, 422]).toContain(response.status())
  })

  test('mlops experiments endpoint responds', async ({ request }) => {
    const baseURL = process.env.BACKEND_URL || 'http://localhost:8000'
    const response = await request.get(`${baseURL}/api/v1/mlops/experiments`, { timeout: 30_000 })
    expect([200, 401, 403, 422]).toContain(response.status())
  })

  test('mlops experiments compare endpoint is reachable (not shadowed)', async ({ request }) => {
    const baseURL = process.env.BACKEND_URL || 'http://localhost:8000'
    // Previously shadowed by /{run_id} — should now return 422 (missing param) not 404
    const response = await request.get(`${baseURL}/api/v1/mlops/experiments/compare`, { timeout: 30_000 })
    // 422 = missing required query param, 401/403 = auth — all mean route is reachable
    // 404 would mean route is still shadowed
    expect(response.status()).not.toBe(404)
  })

  test('ml runs endpoint responds', async ({ request }) => {
    const baseURL = process.env.BACKEND_URL || 'http://localhost:8000'
    const response = await request.get(`${baseURL}/api/v1/internal/ml/runs`, { timeout: 30_000 })
    expect([200, 401, 403, 422]).toContain(response.status())
  })
})
