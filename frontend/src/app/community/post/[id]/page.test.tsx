import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./PostClient', () => ({ default: () => null }))
// `cache` only exists in the react-server build; per-request dedupe is irrelevant here.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({ notFound: () => notFound() }))

import PostPage, { generateMetadata } from './page'

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function mockFetch(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  )
}

describe('/community/post/[id]', () => {
  beforeEach(() => {
    vi.stubEnv('BACKEND_INTERNAL_URL', 'http://backend.test')
    notFound.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('builds title, description and self-canonical from the post', async () => {
    mockFetch(200, {
      id: 42,
      title: 'NVDA after earnings: what the guide implies',
      body: '**Data center** revenue grew again. [Filing](https://sec.gov/x) shows margins held.',
      community_name: 'Stocks',
    })
    const m = await generateMetadata(params('42'))
    expect(m.title).toEqual({ absolute: 'NVDA after earnings: what the guide implies | QuantTrade AI' })
    expect(m.description).toBe('Data center revenue grew again. Filing shows margins held.')
    expect(m.alternates?.canonical).toBe('/community/post/42')
    expect((m.openGraph as { type: string }).type).toBe('article')
  })

  it('calls notFound() when the API says the post does not exist', async () => {
    mockFetch(404, { detail: 'Post not found' })
    await expect(PostPage(params('43'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('calls notFound() for non-numeric ids without hitting the API', async () => {
    mockFetch(200, {})
    await expect(PostPage(params('abc'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not 404 when the backend is unavailable', async () => {
    mockFetch(503)
    await expect(PostPage(params('44'))).resolves.toBeTruthy()
    const m = await generateMetadata(params('44'))
    expect(m.alternates?.canonical).toBe('/community/post/44')
  })
})
