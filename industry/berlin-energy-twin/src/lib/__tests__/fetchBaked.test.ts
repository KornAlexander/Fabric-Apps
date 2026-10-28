import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchBakedJson, prefetchBaked } from '../fetchBaked'

/**
 * ⚠️ These run in the NODE environment, so `DecompressionStream`, `fetch` and
 * `DOMException` are whatever we put there. Each test stubs exactly what it
 * needs and the module cache is reset between them, because `fetchBaked` keeps
 * an in-flight map for the life of the module.
 */
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

function jsonResponse(body: unknown) {
  return {
    ok: true,
    body: null,
    headers: { get: () => 'application/json' },
    json: async () => body,
    clone() {
      return this
    },
  }
}

describe('loading a baked file', () => {
  it('falls back to the plain .json when the browser cannot inflate', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url)
      return jsonResponse({ hello: 'world' })
    })
    const mod = await import('../fetchBaked')
    await expect(mod.fetchBakedJson('data/x.json')).resolves.toEqual({ hello: 'world' })
    // No .gz attempt at all - asking for one we cannot read wastes a request.
    expect(seen).toEqual(['data/x.json'])
  })

  it('fetches a file only ONCE however many callers ask', async () => {
    // The reason this exists: the app prefetches during sign-in and then the
    // components ask again. Without the shared promise every baked file would
    // be downloaded twice, which is worse than not prefetching at all.
    vi.stubGlobal('DecompressionStream', undefined)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return jsonResponse({ n: calls })
    })
    const mod = await import('../fetchBaked')
    const [a, b, c] = await Promise.all([
      mod.fetchBakedJson('data/y.json'),
      mod.fetchBakedJson('data/y.json'),
      mod.fetchBakedJson('data/y.json'),
    ])
    expect(calls).toBe(1)
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('lets a later caller retry after a failure', async () => {
    // A cached rejection would make one flaky load permanent for the session.
    vi.stubGlobal('DecompressionStream', undefined)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      if (calls === 1) throw new Error('network down')
      return jsonResponse({ ok: true })
    })
    const mod = await import('../fetchBaked')
    await expect(mod.fetchBakedJson('data/z.json')).rejects.toThrow()
    await expect(mod.fetchBakedJson('data/z.json')).resolves.toEqual({ ok: true })
    expect(calls).toBe(2)
  })

  it('reports a failed plain fetch rather than returning nothing', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 500,
      body: null,
      headers: { get: () => 'application/json' },
      json: async () => ({}),
      clone() {
        return this
      },
    }))
    const mod = await import('../fetchBaked')
    await expect(mod.fetchBakedJson('data/bad.json')).rejects.toThrow(/500/)
  })

  it('treats an HTML answer as a missing file (Fabric serves index.html with 200)', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' } }))
    const mod = await import('../fetchBaked')
    await expect(mod.fetchFile('data/buildings-x.bin')).rejects.toThrow(/HTML/)
  })

  it('prefetching never throws, whatever the network does', async () => {
    // It runs before the app renders; an unhandled rejection there would
    // surface as a console error on a screen that has not drawn yet.
    vi.stubGlobal('DecompressionStream', undefined)
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const mod = await import('../fetchBaked')
    expect(() => mod.prefetchBaked(['data/a.json', 'data/b.json'])).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('hands a prefetched file straight to the component that wants it', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return jsonResponse({ from: 'prefetch' })
    })
    const mod = await import('../fetchBaked')
    mod.prefetchBaked(['data/p.json'])
    await expect(mod.fetchBakedJson('data/p.json')).resolves.toEqual({ from: 'prefetch' })
    expect(calls).toBe(1)
  })
})

void fetchBakedJson
void prefetchBaked
