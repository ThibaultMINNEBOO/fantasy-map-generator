import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'

const app = createApp({ renderPng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })
const env = { MAX_CELLS: '20000' }

const post = (body: unknown, headers: Record<string, string> = {}, e: object = env) =>
  app.request('/v1/maps', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } }, e)

describe('POST /v1/maps', () => {
  it('returns a PNG by default', async () => {
    const res = await post({ countries: ['A', 'B'], seed: 1, cells: 2000 })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('X-Map-Seed')).toBe('1')
  })

  it('generates a seed when none is given and does not cache', async () => {
    const res = await post({ countries: ['A'], cells: 2000, format: 'json' })
    const body = (await res.json()) as { seed: string }
    expect(body.seed).toMatch(/^\d{9}$/)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns the displayed data as JSON', async () => {
    const res = await post({
      seed: 'x',
      cells: 2000,
      format: 'json',
      includeGeometry: true,
      countries: [{ id: 'north', name: 'Nordmark', capital: 'Isen', cities: ['Frost'] }, 'Sudland'],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.countries).toHaveLength(2)
    expect(body.countries[0]).toMatchObject({ id: 'north', name: 'Nordmark', capital: { name: 'Isen' } })
    expect(body.countries[0].cities[0].name).toBe('Frost')
    expect(body.countries[1].id).toBe('1')
    expect(body.countries[0].outline.length).toBeGreaterThan(0)
    expect(body.request.seed).toBe('x')
    expect(body.imageUrl).toContain('/v1/maps?payload=')
  })

  it('returns an SVG', async () => {
    const res = await post({ countries: ['Aldoria'], seed: 2, cells: 2000, format: 'svg' })
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml')
    expect(await res.text()).toContain('Aldoria')
  })

  it('answers 304 when the ETag matches', async () => {
    const first = await post({ countries: ['A'], seed: 3, cells: 2000, format: 'svg' })
    const res = await post({ countries: ['A'], seed: 3, cells: 2000, format: 'svg' }, { 'If-None-Match': first.headers.get('ETag')! })
    expect(res.status).toBe(304)
  })

  it('rejects invalid payloads with details', async () => {
    const res = await post({ countries: [], template: 'moon' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { issues: { path: string }[] }
    expect(body.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['countries', 'template']))
  })

  it('rejects malformed JSON as JSON', async () => {
    const res = await app.request('/v1/maps', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } }, env)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_request')
  })

  it('enforces MAX_CELLS', async () => {
    const res = await post({ countries: ['A'], cells: 30000 })
    expect(res.status).toBe(400)
  })

  it('requires the API key when configured', async () => {
    const e = { ...env, API_KEY: 'secret' }
    expect((await post({ countries: ['A'], seed: 1, cells: 2000 }, {}, e)).status).toBe(401)
    expect((await post({ countries: ['A'], seed: 1, cells: 2000 }, { Authorization: 'Bearer secret' }, e)).status).toBe(200)
  })
})

describe('GET /v1/maps', () => {
  it('accepts query parameters', async () => {
    const res = await app.request('/v1/maps?countries=A,B&seed=4&cells=2000&format=json&layers.rivers=false', {}, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.countries.map((c: { name: string }) => c.name)).toEqual(['A', 'B'])
    expect(body.request.layers.rivers).toBe(false)
  })

  it('replays the imageUrl of a JSON response', async () => {
    const json = (await (await post({ countries: ['Élan'], seed: 5, cells: 2000, format: 'json' })).json()) as { imageUrl: string }
    const url = new URL(json.imageUrl)
    const res = await app.request(url.pathname + url.search, {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })
})

describe('GET /v1/options', () => {
  it('lists templates and styles', async () => {
    const body = (await (await app.request('/v1/options', {}, env)).json()) as { templates: string[]; styles: string[] }
    expect(body.templates).toContain('continents')
    expect(body.styles).toContain('political')
  })
})
