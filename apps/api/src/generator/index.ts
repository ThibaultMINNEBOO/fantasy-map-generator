import { alegreya, cinzelBold } from '../render/font-metrics'
import { buildGrid, type Grid } from './grid'
import { generateHeightmap, SEA_LEVEL, type TemplateName } from './heightmap'
import {
  CAPITAL_FONT,
  CAPITAL_RADIUS,
  CITY_RADIUS,
  placePointLabels,
  placeRegionLabel,
  SETTLEMENT_FONT,
  type Box,
  type LabelLayout,
  type PointLabel,
  type PointLabelInput,
} from './labels'
import {
  assignBiomes,
  computePrecipitation,
  computeTemperatures,
  markFeatures,
  type Features,
} from './physical'
import { createRng, randFloat } from './random'
import { computeHydrology, type Hydrology } from './rivers'
import { computeSuitability, expandStates, placeCapitals, placeCities } from './states'

export { GenerationError } from './states'

/** Bump when the algorithm changes in a way that alters maps (used in cache keys). */
export const GENERATOR_VERSION = 1

export interface CountryInput {
  name: string
  id?: string
  color?: string
  capital?: string
  cities?: string[]
  /** Relative expansion strength, 1 = default. Changes the borders. */
  expansionism?: number
}

export interface MapOptions {
  seed: string
  width: number
  height: number
  cells: number
  template: TemplateName
  countries: CountryInput[]
  latitudeNorth: number
  latitudeSouth: number
  riverDensity: number
  /** 0 = every land cell belongs to a country; > 0 limits expansion (leaves neutral lands). */
  neutralDistance: number
}

export interface Settlement {
  name: string | null
  cell: number
  x: number
  y: number
  label: PointLabel | null
}

export interface CountryData {
  index: number
  id: string
  name: string
  color: string
  capital: Settlement
  cities: Settlement[]
  cells: number[]
  /** Share of the total land, 0..1. */
  landShare: number
  neighbors: number[]
  label: LabelLayout | null
  bbox: [minX: number, minY: number, maxX: number, maxY: number]
}

export interface MapData {
  options: MapOptions
  grid: Grid
  heights: Uint8Array
  features: Features
  temperature: Int8Array
  precipitation: Float32Array
  hydrology: Hydrology
  biomes: Uint8Array
  /** Country index of each cell, -1 for water or neutral land. */
  state: Int16Array
  countries: CountryData[]
  warnings: string[]
}

export const PALETTE = [
  '#e6a57e', '#8fbf8f', '#8fa9d6', '#d9c27a', '#c792c9', '#7ec4c1', '#e08e8e', '#a9c46a',
  '#b59ad8', '#e3b563', '#79b2a0', '#d6a0b5', '#9fb3c8', '#c9a57b', '#8dc7e0', '#d4d07c',
  '#b88c8c', '#91c98f', '#c4b6e3', '#e1a36f', '#7fa7a1', '#c7c18b', '#a88fc0', '#9bc4a7',
]

export function generateMap(options: MapOptions): MapData {
  const { seed, width, height, countries: input } = options
  const warnings: string[] = []

  // Physical world: only depends on seed, size, cells and template.
  const grid = buildGrid(width, height, options.cells, createRng(seed, 'grid'))
  const heights = generateHeightmap(grid, options.template, createRng(seed, 'heightmap'))
  const features = markFeatures(grid, heights)
  const temperature = computeTemperatures(grid, heights, options.latitudeNorth, options.latitudeSouth)
  const precipitation = computePrecipitation(grid, heights, features, createRng(seed, 'climate'))
  const hydrology = computeHydrology(grid, heights, features, precipitation, options.riverDensity)
  const biomes = assignBiomes(grid, heights, temperature, precipitation, hydrology.flux, hydrology.threshold)

  // Political world: depends on the number of countries (and their expansionism), never on names.
  const suitability = computeSuitability(grid, heights, features, biomes, hydrology)
  const capitals = placeCapitals(grid, suitability, input.length, createRng(seed, `capitals:${input.length}`))
  const powerRng = createRng(seed, `power:${input.length}`)
  const expansionism = input.map((c) => (c.expansionism ?? 1) * randFloat(powerRng, 0.8, 1.4))
  const state = expandStates(grid, heights, features, biomes, hydrology, capitals, expansionism, options.neutralDistance)

  const cellsByState: number[][] = input.map(() => [])
  const neighborSets = input.map(() => new Set<number>())
  let landCells = 0
  for (let i = 0; i < grid.count; i++) {
    if (heights[i] >= SEA_LEVEL) landCells++
    const s = state[i]
    if (s < 0) continue
    cellsByState[s].push(i)
    for (const nb of grid.neighbors[i]) if (state[nb] >= 0 && state[nb] !== s) neighborSets[s].add(state[nb])
  }

  const cityCells = placeCities(
    grid,
    state,
    suitability,
    capitals,
    input.map((c) => c.cities?.length ?? 0),
    createRng(seed, `cities:${input.length}`),
  )

  const colors = assignColors(input, neighborSets)
  const scale = Math.sqrt(width * height) / 1200
  const measure = (text: string) => measureText(text, cinzelBold, 0.08)

  // Settlement labels first; together with their markers they are obstacles for country labels.
  const margin = 14 * scale
  const bounds: Box = [margin, margin, width - margin, height - margin]
  const pointInputs: PointLabelInput[] = []
  const pointCells: number[] = []
  const addPoint = (cell: number, name: string | undefined, radius: number, font: number) => {
    pointCells.push(cell)
    pointInputs.push({
      x: grid.points[2 * cell],
      y: grid.points[2 * cell + 1],
      radius: radius * scale,
      name: name ?? null,
      fontSize: Math.round(font * scale * 10) / 10,
    })
  }
  input.forEach((country, s) => addPoint(capitals[s], country.capital, CAPITAL_RADIUS, CAPITAL_FONT))
  input.forEach((country, s) =>
    cityCells[s].forEach((cell, k) => addPoint(cell, country.cities?.[k], CITY_RADIUS, SETTLEMENT_FONT)),
  )
  const { labels: pointLabels, boxes: obstacles } = placePointLabels(pointInputs, bounds, (t) => measureText(t, alegreya))
  const settlementByCell = new Map<number, Settlement>()
  pointCells.forEach((cell, k) => {
    const label = pointLabels[k]
    settlementByCell.set(cell, {
      name: pointInputs[k].name,
      cell,
      x: round(grid.points[2 * cell]),
      y: round(grid.points[2 * cell + 1]),
      label: label && { ...label, x: round(label.x), y: round(label.y) },
    })
  })

  const countries = input.map((country, s): CountryData => {
    const cells = cellsByState[s]
    const cities = cityCells[s].map((cell) => settlementByCell.get(cell)!)
    const requested = country.cities?.length ?? 0
    if (cities.length < requested) {
      warnings.push(`Country "${country.name}" is too small for ${requested} cities, only ${cities.length} placed.`)
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const c of cells) {
      const x = grid.points[2 * c]
      const y = grid.points[2 * c + 1]
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }

    const label = placeRegionLabel(grid, state, s, cells, country.name, measure, 9 * scale, 46 * scale, obstacles, bounds)
    if (label) {
      label.x = round(label.x)
      label.y = round(label.y)
    }

    return {
      index: s,
      id: country.id ?? String(s),
      name: country.name,
      color: colors[s],
      capital: settlementByCell.get(capitals[s])!,
      cities,
      cells,
      landShare: landCells ? Math.round((cells.length / landCells) * 10000) / 10000 : 0,
      neighbors: [...neighborSets[s]].sort((a, b) => a - b),
      label,
      bbox: [round(minX), round(minY), round(maxX), round(maxY)],
    }
  })

  return {
    options,
    grid,
    heights,
    features,
    temperature,
    precipitation,
    hydrology,
    biomes,
    state,
    countries,
    warnings,
  }
}

const round = (v: number) => Math.round(v * 10) / 10

export function measureText(text: string, widths: Record<string, number>, letterSpacing = 0): number {
  let w = 0
  for (const ch of text) w += (widths[ch] ?? 0.62) + letterSpacing
  return w
}

/** Uses requested colors, otherwise a palette color that differs from already colored neighbours. */
function assignColors(input: CountryInput[], neighbors: Set<number>[]): string[] {
  const colors: string[] = new Array(input.length)
  input.forEach((c, s) => {
    if (c.color) colors[s] = c.color
  })
  input.forEach((c, s) => {
    if (colors[s]) return
    const taken = new Set([...neighbors[s]].map((n) => colors[n]).filter(Boolean))
    for (let k = 0; k < PALETTE.length; k++) {
      const color = PALETTE[(s + k) % PALETTE.length]
      if (!taken.has(color)) {
        colors[s] = color
        return
      }
    }
    colors[s] = PALETTE[s % PALETTE.length]
  })
  return colors
}
