import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { generateMap, GenerationError, GENERATOR_VERSION, PALETTE, type MapData } from './generator'
import { TEMPLATE_NAMES } from './generator/heightmap'
import { randomSeed } from './generator/random'
import { regionLoops } from './render/geometry'
import type { PngRenderer } from './render/png'
import { computeSmoothVertices, renderSvg, STYLES } from './render/svg'
import { base64UrlEncode, MapRequestSchema, requestFromQuery, type MapRequest } from './schema'

export interface AppDeps {
  renderPng: PngRenderer
}

type Env = {
  Bindings: CloudflareBindings & { API_KEY?: string }
}

const CONTENT_TYPES = { png: 'image/png', svg: 'image/svg+xml; charset=utf-8', json: 'application/json; charset=utf-8' }

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>()

  app.use(
    '*',
    cors({ origin: '*', exposeHeaders: ['X-Map-Seed', 'X-Map-Warnings', 'X-Generator-Version', 'ETag'], maxAge: 86400 }),
  )

  // Optional authentication: enabled when the API_KEY secret is set.
  app.use('/v1/*', async (c, next) => {
    const token = c.env?.API_KEY
    if (!token) return next()
    return bearerAuth({ token })(c as Context, next)
  })

  app.onError((err, c) => {
    if (err instanceof GenerationError) return c.json({ error: 'generation_failed', message: err.message }, 422)
    if (err instanceof SyntaxError) return c.json({ error: 'invalid_request', message: err.message }, 400)
    if (err instanceof HTTPException) {
      if (err.status === 401) return err.getResponse()
      return c.json({ error: err.status < 500 ? 'invalid_request' : 'internal_error', message: err.message }, err.status)
    }
    console.error(err)
    return c.json({ error: 'internal_error', message: 'Unexpected error while generating the map' }, 500)
  })

  app.notFound((c) => c.json({ error: 'not_found', message: `No route for ${c.req.method} ${c.req.path}` }, 404))

  app.get('/', (c) =>
    c.json({
      name: 'Fantasy Map Generator API',
      generatorVersion: GENERATOR_VERSION,
      endpoints: {
        'POST /v1/maps': 'Generate a map from a JSON payload (format: png | svg | json)',
        'GET /v1/maps': 'Same with query parameters (?countries=A,B&seed=42) or ?payload=<base64url JSON>',
        'GET /v1/options': 'Templates, styles, defaults and limits',
        'GET /v1/schema': 'JSON Schema of the request payload',
      },
    }),
  )

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/v1/options', (c) =>
    c.json({
      templates: TEMPLATE_NAMES,
      styles: STYLES,
      formats: ['png', 'svg', 'json'],
      palette: PALETTE,
      defaults: MapRequestSchema.parse({ countries: ['Example'] }),
      limits: { countries: 64, cells: maxCells(c), width: 4096, height: 4096, pngMegapixels: 16 },
    }),
  )

  app.get('/v1/schema', (c) => c.json(z.toJSONSchema(MapRequestSchema, { io: 'input', unrepresentable: 'any' })))

  app.post(
    '/v1/maps',
    zValidator('json', MapRequestSchema, (result, c) => {
      if (!result.success) return c.json({ error: 'invalid_request', issues: result.error.issues.map(formatIssue) }, 400)
    }),
    (c) => handleMap(c, c.req.valid('json')),
  )

  app.get('/v1/maps', async (c) => {
    const result = MapRequestSchema.safeParse(requestFromQuery(c.req.queries()))
    if (!result.success) return c.json({ error: 'invalid_request', issues: result.error.issues.map(formatIssue) }, 400)
    return handleMap(c, result.data)
  })

  async function handleMap(c: Context<Env>, req: MapRequest) {
    const limit = maxCells(c)
    if (req.cells > limit) {
      return c.json({ error: 'invalid_request', issues: [{ path: 'cells', message: `Must be at most ${limit}` }] }, 400)
    }

    const seeded = req.seed !== undefined
    const request = { ...req, seed: req.seed ?? randomSeed() }
    const key = await hashRequest(request)
    const etag = `"${key}"`
    if (seeded && c.req.header('If-None-Match') === etag) return c.body(null, 304)

    const cache = typeof caches !== 'undefined' ? await caches.open('maps') : null
    const cacheKey = `https://cache.fantasy-map.internal/${key}`
    if (seeded && cache) {
      const hit = await cache.match(cacheKey)
      if (hit) return new Response(hit.body, hit)
    }

    const map = generateMap({
      seed: request.seed,
      width: request.width,
      height: request.height,
      cells: request.cells,
      template: request.template,
      countries: request.countries,
      latitudeNorth: request.latitude.north,
      latitudeSouth: request.latitude.south,
      riverDensity: request.riverDensity,
      neutralDistance: request.neutralLands,
    })

    const headers: Record<string, string> = {
      'Content-Type': CONTENT_TYPES[request.format],
      'X-Map-Seed': request.seed,
      'X-Generator-Version': String(GENERATOR_VERSION),
      ETag: etag,
      'Cache-Control': seeded ? 'public, max-age=86400' : 'no-store',
    }
    if (map.warnings.length) headers['X-Map-Warnings'] = encodeURIComponent(JSON.stringify(map.warnings))

    let body: BodyInit
    if (request.format === 'json') {
      body = JSON.stringify(toJson(map, request, new URL(c.req.url).origin))
    } else {
      const svg = renderSvg(map, {
        style: request.style,
        title: request.title,
        ...request.layers,
        webFonts: request.format === 'svg',
      })
      body = request.format === 'svg' ? svg : ((await deps.renderPng(svg, request.scale)) as Uint8Array<ArrayBuffer>)
    }

    const response = new Response(body, { headers })
    if (seeded && cache) c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))

    return response
  }

  return app
}

function maxCells(c: Context<Env>) {
  return Number(c.env?.MAX_CELLS ?? 20000)
}

function formatIssue(issue: z.core.$ZodIssue) {
  return { path: issue.path.join('.'), message: issue.message }
}

async function hashRequest(request: object): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify({ v: GENERATOR_VERSION, request }))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** JSON output: everything displayed on the map, plus the normalised request to replay it. */
function toJson(map: MapData, request: MapRequest & { seed: string }, origin: string) {
  const { countries, grid, options } = map
  let outlines: Map<number, number[][]> | null = null
  let coords: Float64Array | null = null
  if (request.includeGeometry) {
    coords = computeSmoothVertices(map)
    outlines = regionLoops(grid, (c) => (map.state[c] >= 0 ? map.state[c] : undefined))
  }
  const round = (v: number) => Math.round(v * 10) / 10
  const replay = { ...request, format: 'png' as const, includeGeometry: false }
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(replay)))

  return {
    seed: options.seed,
    generatorVersion: GENERATOR_VERSION,
    width: options.width,
    height: options.height,
    template: options.template,
    style: request.style,
    request,
    imageUrl: `${origin}/v1/maps?payload=${payload}`,
    warnings: map.warnings,
    countries: countries.map((country) => ({
      index: country.index,
      id: country.id,
      name: country.name,
      color: country.color,
      capital: omitCell(country.capital),
      cities: country.cities.map(omitCell),
      cellCount: country.cells.length,
      landShare: country.landShare,
      neighbors: country.neighbors.map((n) => countries[n].id),
      label: country.label,
      bbox: country.bbox,
      ...(outlines && coords
        ? {
            outline: (outlines.get(country.index) ?? []).map((loop) =>
              loop.map((v) => [round(coords![2 * v]), round(coords![2 * v + 1])]),
            ),
          }
        : {}),
    })),
  }
}

function omitCell<T extends { cell: number }>({ cell: _, ...rest }: T) {
  return rest
}
