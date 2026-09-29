import type { MapData, Settlement } from '../generator'
import { SEA_LEVEL } from '../generator/heightmap'
import { CAPITAL_RADIUS, CITY_RADIUS } from '../generator/labels'
import { BIOMES, FeatureType } from '../generator/physical'
import {
  boundaryChains,
  chaikin,
  pathFromChains,
  pathFromLoops,
  pathFromPoints,
  regionLoops,
  smoothVertices,
} from './geometry'

export const STYLES = ['political', 'physical', 'parchment'] as const
export type MapStyle = (typeof STYLES)[number]

export interface RenderOptions {
  style: MapStyle
  title?: string
  labels: boolean
  cities: boolean
  rivers: boolean
  relief: boolean
  borders: boolean
  frame: boolean
  /** Adds a Google Fonts import, useful when the SVG itself is displayed by a browser. */
  webFonts: boolean
}

interface Theme {
  oceanBands: string[]
  lake: string
  land: string
  coast: string
  stateOpacity: number
  biomes: boolean
  biomeOpacity: number
  river: string
  border: string
  borderDash?: string
  text: string
  halo: string
  mountainLight: string
  mountainShade: string
  mountainStroke: string
  frame: string
}

const THEMES: Record<MapStyle, Theme> = {
  political: {
    oceanBands: ['#b8d3e3', '#a9c8dc', '#9cbed5', '#8fb4ce', '#84abc7', '#7aa2c0'],
    lake: '#a9c8dc',
    land: '#eee4cc',
    coast: '#3f3a36',
    stateOpacity: 0.62,
    biomes: false,
    biomeOpacity: 0,
    river: '#5d88b3',
    border: '#4a3f38',
    text: '#2f261e',
    halo: 'rgba(255,252,240,0.75)',
    mountainLight: '#f3ecdc',
    mountainShade: '#b9ab94',
    mountainStroke: '#5e5146',
    frame: '#3f3a36',
  },
  physical: {
    oceanBands: ['#9ec3dd', '#8cb6d4', '#7ca9ca', '#6e9dc1', '#6292b8', '#5787ae'],
    lake: '#8cb6d4',
    land: '#c8d68f',
    coast: '#34414a',
    stateOpacity: 0,
    biomes: true,
    biomeOpacity: 0.9,
    river: '#4a7fb3',
    border: '#3b3030',
    borderDash: '6 3',
    text: '#1f1a16',
    halo: 'rgba(255,255,255,0.7)',
    mountainLight: '#efe8dc',
    mountainShade: '#a8977f',
    mountainStroke: '#4f4236',
    frame: '#2d3438',
  },
  parchment: {
    oceanBands: ['#d9c9a3', '#d3c29b', '#cdbb93', '#c7b48c', '#c1ad85', '#bba67e'],
    lake: '#d3c29b',
    land: '#efe1bd',
    coast: '#5a4630',
    stateOpacity: 0.28,
    biomes: false,
    biomeOpacity: 0,
    river: '#8c7456',
    border: '#6b5237',
    borderDash: '5 2 1 2',
    text: '#3e2c1a',
    halo: 'rgba(245,233,205,0.8)',
    mountainLight: '#f2e6c8',
    mountainShade: '#c2a97f',
    mountainStroke: '#5a4630',
    frame: '#5a4630',
  },
}

const LAKE = -100
const NEUTRAL = -50
const OUTSIDE = -1000

const OCEAN_BANDS = 6

/** Voronoi vertices smoothed along coasts, lake shores, depth bands and country borders. */
export function computeSmoothVertices(map: MapData): Float64Array {
  const { grid, features, state } = map
  const n = grid.count
  return smoothVertices(grid, (c) => {
    if (c >= n) return OUTSIDE
    if (features.type[c] === FeatureType.Lake) return LAKE
    if (features.type[c] === FeatureType.Ocean) return -Math.min(-features.distance[c], OCEAN_BANDS)
    return state[c] >= 0 ? state[c] : NEUTRAL
  })
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!)
}

const r1 = (v: number) => Math.round(v * 10) / 10

export function renderSvg(map: MapData, opts: RenderOptions): string {
  const { grid, heights, features, state, countries } = map
  const { width, height } = grid
  const theme = THEMES[opts.style]
  const scale = Math.sqrt(width * height) / 1200
  const n = grid.count

  const oceanBand = (c: number) => Math.min(-features.distance[c] - 1, OCEAN_BANDS - 1)
  const smooth = computeSmoothVertices(map)
  const raw = grid.vertices
  const isLand = (c: number) => heights[c] >= SEA_LEVEL

  const out: string[] = []
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  )
  if (opts.webFonts) {
    out.push(
      `<style>@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700&amp;family=Alegreya+SC&amp;display=swap');</style>`,
    )
  }

  const landLoops = regionLoops(grid, (c) => (isLand(c) ? 0 : undefined)).get(0) ?? []
  const landPath = pathFromLoops(landLoops, smooth)
  out.push(`<defs><clipPath id="land"><path d="${landPath}" clip-rule="evenodd"/></clipPath></defs>`)

  // Ocean depth bands, deepest first.
  out.push(`<rect width="${width}" height="${height}" fill="${theme.oceanBands[theme.oceanBands.length - 1]}"/>`)
  const bands = new Set<number>()
  for (let c = 0; c < n; c++) if (features.type[c] === FeatureType.Ocean) bands.add(oceanBand(c))
  // Bands are drawn as "everything shallower than k" so that no gap can appear between them.
  const shallowerThan = (k: number) =>
    regionLoops(grid, (c) => (features.type[c] !== FeatureType.Ocean || oceanBand(c) <= k ? 0 : undefined)).get(0) ?? []
  out.push('<g id="ocean">')
  for (let k = theme.oceanBands.length - 2; k >= 0; k--) {
    if (!bands.has(k)) continue
    out.push(`<path d="${pathFromLoops(shallowerThan(k), smooth)}" fill="${theme.oceanBands[k]}" fill-rule="evenodd"/>`)
  }
  out.push('</g>')

  // Land base.
  out.push(`<path id="landmass" d="${landPath}" fill="${theme.land}" fill-rule="evenodd"/>`)

  out.push('<g clip-path="url(#land)">')
  if (theme.biomes) {
    const biomeLoops = regionLoops(grid, (c) => (isLand(c) ? map.biomes[c] : undefined))
    for (const [b, loops] of biomeLoops) {
      out.push(`<path d="${pathFromLoops(loops, raw)}" fill="${BIOMES[b].color}" fill-opacity="${theme.biomeOpacity}" fill-rule="evenodd"/>`)
    }
  }
  if (opts.relief) out.push(renderHillshade(map, raw))
  out.push('</g>')

  // Countries.
  if (theme.stateOpacity > 0) {
    const stateLoops = regionLoops(grid, (c) => (state[c] >= 0 ? state[c] : undefined))
    out.push(`<g id="countries" fill-opacity="${theme.stateOpacity}" fill-rule="evenodd">`)
    for (const [s, loops] of stateLoops) {
      out.push(`<path data-country="${escapeXml(countries[s].id)}" d="${pathFromLoops(loops, smooth)}" fill="${countries[s].color}"/>`)
    }
    out.push('</g>')
  }

  // Lakes.
  const lakeLoops = regionLoops(grid, (c) => (features.type[c] === FeatureType.Lake ? 0 : undefined)).get(0)
  if (lakeLoops?.length) {
    out.push(
      `<path id="lakes" d="${pathFromLoops(lakeLoops, smooth)}" fill="${theme.lake}" stroke="${theme.coast}" stroke-width="${r1(0.7 * scale)}" stroke-opacity="0.7" fill-rule="evenodd"/>`,
    )
  }

  if (opts.relief) out.push(renderMountains(map, theme, scale))
  if (opts.rivers) out.push(renderRivers(map, theme.river, scale))

  if (opts.borders) {
    const chains = boundaryChains(grid, (a, b) => isLand(a) && isLand(b) && state[a] !== state[b])
    if (chains.length) {
      const dash = theme.borderDash ? ` stroke-dasharray="${theme.borderDash.split(' ').map((v) => r1(Number(v) * scale)).join(' ')}"` : ''
      out.push(
        `<path id="borders" d="${pathFromChains(chains, smooth)}" fill="none" stroke="${theme.border}" stroke-width="${r1(1.4 * scale)}" stroke-opacity="0.85" stroke-linejoin="round" stroke-linecap="round"${dash}/>`,
      )
    }
  }

  out.push(
    `<path id="coastline" d="${landPath}" fill="none" stroke="${theme.coast}" stroke-width="${r1(1.1 * scale)}" stroke-linejoin="round"/>`,
  )

  if (opts.cities) out.push(renderSettlements(map, theme, scale, opts.labels))
  if (opts.labels) out.push(renderCountryLabels(map, theme))
  if (opts.title) {
    const size = r1(34 * scale)
    out.push(
      `<text x="${width / 2}" y="${r1(size * 1.4)}" text-anchor="middle" font-family="Cinzel" font-weight="700" font-size="${size}" letter-spacing="${r1(size * 0.12)}" fill="${theme.text}" stroke="${theme.halo}" stroke-width="${r1(size * 0.16)}" paint-order="stroke" stroke-linejoin="round">${escapeXml(opts.title)}</text>`,
    )
  }
  if (opts.frame) {
    const w = r1(6 * scale)
    out.push(
      `<rect x="${w / 2}" y="${w / 2}" width="${width - w}" height="${height - w}" fill="none" stroke="${theme.frame}" stroke-width="${w}"/>`,
      `<rect x="${w * 1.6}" y="${w * 1.6}" width="${r1(width - w * 3.2)}" height="${r1(height - w * 3.2)}" fill="none" stroke="${theme.frame}" stroke-width="${r1(w / 5)}"/>`,
    )
  }
  out.push('</svg>')
  return out.join('\n')
}

/** Light from the north-west, quantised in a few levels merged into regions. */
function renderHillshade(map: MapData, coords: Float64Array): string {
  const { grid, heights } = map
  const n = grid.count
  const level = new Int8Array(n)
  for (let i = 0; i < n; i++) {
    if (heights[i] < SEA_LEVEL) continue
    const x = grid.points[2 * i]
    const y = grid.points[2 * i + 1]
    let sxx = 0
    let syy = 0
    let sxh = 0
    let syh = 0
    for (const c of grid.neighbors[i]) {
      const dx = (grid.points[2 * c] - x) / grid.spacing
      const dy = (grid.points[2 * c + 1] - y) / grid.spacing
      const dh = Math.max(heights[c], SEA_LEVEL) - heights[i]
      sxx += dx * dx
      syy += dy * dy
      sxh += dx * dh
      syh += dy * dh
    }
    const gx = sxx ? sxh / sxx : 0
    const gy = syy ? syh / syy : 0
    const light = (gx + gy) / Math.SQRT2
    level[i] = Math.max(-4, Math.min(4, Math.round(light / 2.5)))
  }
  const loops = regionLoops(grid, (c) => (heights[c] >= SEA_LEVEL && level[c] !== 0 ? level[c] : undefined))
  const out: string[] = ['<g id="hillshade" fill-rule="evenodd">']
  for (const [l, lp] of [...loops].sort((a, b) => a[0] - b[0])) {
    const fill = l > 0 ? '#ffffff' : '#3a2a1a'
    const opacity = l > 0 ? 0.045 * l : 0.05 * -l
    out.push(`<path d="${pathFromLoops(lp, coords)}" fill="${fill}" fill-opacity="${r1(opacity * 100) / 100}"/>`)
  }
  out.push('</g>')
  return out.join('')
}

function renderMountains(map: MapData, theme: Theme, scale: number): string {
  const { grid, heights } = map
  const cells: number[] = []
  for (let i = 0; i < grid.count; i++) if (heights[i] >= 50) cells.push(i)
  cells.sort((a, b) => heights[b] - heights[a] || a - b)

  const placed: [x: number, y: number, size: number, hill: boolean][] = []
  for (const c of cells) {
    const h = heights[c]
    const hill = h < 62
    const size = grid.spacing * (hill ? 0.9 : 1.1 + ((h - 62) / 38) * 1.3)
    const x = grid.points[2 * c]
    const y = grid.points[2 * c + 1]
    const minDist = grid.spacing * (hill ? 1.6 : 1.15)
    if (placed.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < minDist * minDist)) continue
    placed.push([x, y, size, hill])
  }
  placed.sort((a, b) => a[1] - b[1])

  const sw = r1(0.8 * scale)
  const out: string[] = [`<g id="relief" stroke="${theme.mountainStroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">`]
  for (const [x, y, s, hill] of placed) {
    const base = y + s * 0.3
    if (hill) {
      out.push(`<path d="M${r1(x - s / 2)} ${r1(base)}Q${r1(x)} ${r1(base - s * 0.75)} ${r1(x + s / 2)} ${r1(base)}" fill="${theme.mountainLight}"/>`)
    } else {
      const top = base - s * 0.85
      out.push(
        `<path d="M${r1(x - s / 2)} ${r1(base)}L${r1(x)} ${r1(top)}L${r1(x + s / 2)} ${r1(base)}Z" fill="${theme.mountainLight}"/>` +
          `<path d="M${r1(x)} ${r1(top)}L${r1(x + s / 2)} ${r1(base)}L${r1(x + s * 0.12)} ${r1(base)}Z" fill="${theme.mountainShade}" stroke="none"/>`,
      )
    }
  }
  out.push('</g>')
  return out.join('')
}

function renderRivers(map: MapData, color: string, scale: number): string {
  const { grid, hydrology } = map
  const out: string[] = [`<g id="rivers" fill="${color}">`]
  for (const river of hydrology.rivers) {
    const pts: [number, number, number][] = river.cells.map((c, k) => {
      const w = Math.min(0.8 + Math.sqrt(river.flux[k] / hydrology.threshold) * 1.1, 6) * scale
      return [grid.points[2 * c], grid.points[2 * c + 1], w]
    })
    // End the river on the shore rather than at the water cell centre.
    const last = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    pts[pts.length - 1] = [(last[0] + prev[0]) / 2, (last[1] + prev[1]) / 2, prev[2]]
    pts[0][2] = 0.2 * scale

    const smooth = chaikin(pts, 3)
    const left: [number, number][] = []
    const right: [number, number][] = []
    for (let i = 0; i < smooth.length; i++) {
      const a = smooth[Math.max(i - 1, 0)]
      const b = smooth[Math.min(i + 1, smooth.length - 1)]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len = Math.hypot(dx, dy) || 1
      const w = smooth[i][2] / 2
      left.push([smooth[i][0] - (dy / len) * w, smooth[i][1] + (dx / len) * w])
      right.push([smooth[i][0] + (dy / len) * w, smooth[i][1] - (dx / len) * w])
    }
    out.push(`<path d="${pathFromPoints([...left, ...right.reverse()], true)}"/>`)
  }
  out.push('</g>')
  return out.join('')
}

function renderSettlements(map: MapData, theme: Theme, scale: number, labels: boolean): string {
  const out: string[] = [`<g id="settlements">`]
  const text: string[] = []
  const label = (settlement: Settlement) => {
    const l = settlement.label
    if (!labels || !l || !settlement.name) return
    const anchor = l.anchor === 'middle' ? '' : ` text-anchor="${l.anchor}"`
    text.push(`<text x="${l.x}" y="${l.y}" font-size="${l.fontSize}"${anchor}>${escapeXml(settlement.name)}</text>`)
  }
  for (const country of map.countries) {
    const { capital } = country
    const r = r1(CAPITAL_RADIUS * scale)
    out.push(
      `<circle cx="${capital.x}" cy="${capital.y}" r="${r}" fill="#fffaf0" stroke="${theme.text}" stroke-width="${r1(1.2 * scale)}"/>`,
      `<circle cx="${capital.x}" cy="${capital.y}" r="${r1(r * 0.45)}" fill="${theme.text}"/>`,
    )
    label(capital)
    for (const city of country.cities) {
      out.push(`<circle cx="${city.x}" cy="${city.y}" r="${r1(CITY_RADIUS * scale)}" fill="${theme.text}" stroke="#fffaf0" stroke-width="${r1(0.8 * scale)}"/>`)
      label(city)
    }
  }
  out.push('</g>')
  if (text.length) {
    out.push(
      `<g id="settlement-labels" font-family="Alegreya SC" text-anchor="middle" fill="${theme.text}" stroke="${theme.halo}" stroke-width="${r1(3 * scale)}" paint-order="stroke" stroke-linejoin="round">`,
      ...text,
      '</g>',
    )
  }
  return out.join('')
}

function renderCountryLabels(map: MapData, theme: Theme): string {
  const out: string[] = [
    `<g id="country-labels" font-family="Cinzel" font-weight="700" text-anchor="middle" fill="${theme.text}" stroke="${theme.halo}" paint-order="stroke" stroke-linejoin="round">`,
  ]
  for (const country of map.countries) {
    const l = country.label
    if (!l) continue
    const lineHeight = l.fontSize * 1.15
    const firstBaseline = l.y - ((l.lines.length - 1) * lineHeight) / 2 + l.fontSize * 0.35
    const tspans = l.lines
      .map((line, i) => `<tspan x="${l.x}" y="${r1(firstBaseline + i * lineHeight)}">${escapeXml(line)}</tspan>`)
      .join('')
    out.push(
      `<text data-country="${escapeXml(country.id)}" font-size="${l.fontSize}" letter-spacing="${r1(l.fontSize * 0.08)}" stroke-width="${r1(Math.max(l.fontSize * 0.14, 2))}">${tspans}</text>`,
    )
  }
  out.push('</g>')
  return out.join('')
}
