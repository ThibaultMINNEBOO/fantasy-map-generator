import { z } from 'zod'
import { TEMPLATE_NAMES } from './generator/heightmap'
import { STYLES } from './render/svg'

const name = z.string().trim().min(1).max(80)
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, 'Expected a hex color like #aabbcc')

export const CountrySchema = z.union([
  name.transform((n) => ({ name: n })),
  z.object({
    name: name.describe('Displayed name of the country. Never used for the geometry.'),
    id: z.string().trim().min(1).max(64).optional().describe('Your identifier, echoed back in the JSON output.'),
    color: hexColor.optional().describe('Fill color. Defaults to a palette color distinct from neighbours.'),
    capital: name.optional().describe('Displayed name of the capital. Without it the capital marker has no label.'),
    cities: z.array(name).max(20).optional().describe('Displayed names of additional cities, placed automatically.'),
    expansionism: z
      .number()
      .min(0.2)
      .max(5)
      .optional()
      .describe('Relative territorial strength (1 = default). Changes the borders.'),
  }),
])

export const LayersSchema = z
  .object({
    labels: z.boolean().default(true),
    cities: z.boolean().default(true),
    rivers: z.boolean().default(true),
    relief: z.boolean().default(true),
    borders: z.boolean().default(true),
    frame: z.boolean().default(true),
  })
  .prefault({})

export const MapRequestSchema = z
  .object({
    countries: z
      .array(CountrySchema)
      .min(1)
      .max(64)
      .describe('Countries in a stable order: the index of a country determines its territory.'),
    seed: z
      .union([z.string().trim().min(1).max(64), z.number().int().nonnegative()])
      .transform(String)
      .optional()
      .describe('Same seed + same number of countries = same map. Random when omitted.'),
    format: z.enum(['png', 'svg', 'json']).default('png'),
    width: z.number().int().min(320).max(4096).default(1600),
    height: z.number().int().min(240).max(4096).default(900),
    cells: z.number().int().min(1000).max(50000).default(8000).describe('Voronoi cells: detail vs speed.'),
    template: z.enum(TEMPLATE_NAMES).default('continents'),
    style: z.enum(STYLES).default('political'),
    title: z.string().trim().min(1).max(80).optional(),
    scale: z.number().min(0.25).max(4).default(1).describe('PNG pixel ratio (2 = retina).'),
    latitude: z
      .object({
        north: z.number().min(-90).max(90).default(60),
        south: z.number().min(-90).max(90).default(15),
      })
      .prefault({})
      .describe('Latitudes of the top and bottom edges, drives the climate.'),
    riverDensity: z.number().min(0).max(4).default(1),
    neutralLands: z
      .number()
      .min(0)
      .max(10)
      .default(0)
      .describe('0 = all land is claimed. Otherwise lower values leave more unclaimed land.'),
    layers: LayersSchema,
    includeGeometry: z.boolean().default(false).describe('JSON only: include country outlines.'),
  })
  .superRefine((req, ctx) => {
    const ids = req.countries.map((c) => ('id' in c ? c.id : undefined)).filter(Boolean)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['countries'], message: 'Country ids must be unique' })
    }
    const pixels = req.width * req.height * req.scale ** 2
    if (req.format === 'png' && pixels > 16_000_000) {
      ctx.addIssue({ code: 'custom', path: ['scale'], message: 'PNG too large: width × height × scale² must stay under 16 megapixels' })
    }
  })

export type MapRequestInput = z.input<typeof MapRequestSchema>
export type MapRequest = z.output<typeof MapRequestSchema>

/**
 * Builds a request object from query parameters, for GET usage such as `<img src>`:
 * `?countries=A,B,C&seed=42&format=png&layers.rivers=false` or `?payload=<base64url JSON>`.
 */
export function requestFromQuery(query: Record<string, string[]>): unknown {
  const first = (key: string) => query[key]?.[0]
  const payload = first('payload')
  if (payload) {
    const json = new TextDecoder().decode(base64UrlDecode(payload))
    return JSON.parse(json)
  }

  const obj: Record<string, unknown> = {}
  const countries = [...(query.countries ?? []), ...(query.country ?? [])]
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
  obj.countries = countries

  const numbers = ['width', 'height', 'cells', 'scale', 'riverDensity', 'neutralLands']
  for (const [key, values] of Object.entries(query)) {
    const value = values[0]
    if (key === 'countries' || key === 'country') continue
    if (numbers.includes(key)) obj[key] = Number(value)
    else if (key.startsWith('layers.')) {
      const layers = (obj.layers ??= {}) as Record<string, boolean>
      layers[key.slice(7)] = value !== 'false' && value !== '0'
    } else if (key.startsWith('latitude.')) {
      const latitude = (obj.latitude ??= {}) as Record<string, number>
      latitude[key.slice(9)] = Number(value)
    } else if (key === 'includeGeometry') obj[key] = value !== 'false' && value !== '0'
    else obj[key] = value
  }
  return obj
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
