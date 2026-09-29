import type { Grid } from './grid'
import { SEA_LEVEL } from './heightmap'
import type { Rng } from './random'

export const enum FeatureType {
  Land = 0,
  Ocean = 1,
  Lake = 2,
}

export interface Features {
  /** Feature type of each cell. */
  type: Uint8Array
  /** Connected component id (islands, lakes, oceans), 0-based. */
  featureId: Int32Array
  featureCount: number
  /** Distance to the coast in cells: 1, 2, ... on land; -1, -2, ... on water. */
  distance: Int8Array
}

export function markFeatures(grid: Grid, heights: Uint8Array): Features {
  const n = grid.count
  const type = new Uint8Array(n)
  const featureId = new Int32Array(n).fill(-1)
  let featureCount = 0

  for (let start = 0; start < n; start++) {
    if (featureId[start] !== -1) continue
    const land = heights[start] >= SEA_LEVEL
    const id = featureCount++
    const members = [start]
    featureId[start] = id
    let touchesBorder = false
    for (let qi = 0; qi < members.length; qi++) {
      const q = members[qi]
      if (grid.isBorder[q]) touchesBorder = true
      for (const c of grid.neighbors[q]) {
        if (featureId[c] !== -1 || heights[c] >= SEA_LEVEL !== land) continue
        featureId[c] = id
        members.push(c)
      }
    }
    const t = land ? FeatureType.Land : touchesBorder ? FeatureType.Ocean : FeatureType.Lake
    for (const m of members) type[m] = t
  }

  // Signed distance to coast (capped to fit Int8).
  const distance = new Int8Array(n)
  let frontier: number[] = []
  for (let i = 0; i < n; i++) {
    const land = heights[i] >= SEA_LEVEL
    for (const c of grid.neighbors[i]) {
      if (heights[c] >= SEA_LEVEL !== land) {
        distance[i] = land ? 1 : -1
        frontier.push(i)
        break
      }
    }
  }
  for (let d = 2; frontier.length && d < 120; d++) {
    const next: number[] = []
    for (const f of frontier) {
      for (const c of grid.neighbors[f]) {
        if (distance[c] !== 0) continue
        distance[c] = heights[c] >= SEA_LEVEL ? d : -d
        next.push(c)
      }
    }
    frontier = next
  }
  // Cells never reached (map made only of land or only of water).
  for (let i = 0; i < n; i++) if (distance[i] === 0) distance[i] = heights[i] >= SEA_LEVEL ? 120 : -120

  return { type, featureId, featureCount, distance }
}

/** Elevation in meters (Azgaar formula), 0 for water. */
export const heightToMeters = (h: number) => (h < SEA_LEVEL ? 0 : Math.round((h - 18) ** 1.9))

/**
 * Temperature (°C) from latitude and altitude. The map spans from `latitudeNorth` (top) to
 * `latitudeSouth` (bottom), in degrees.
 */
export function computeTemperatures(grid: Grid, heights: Uint8Array, latitudeNorth: number, latitudeSouth: number) {
  const n = grid.count
  const temp = new Int8Array(n)
  const tEquator = 28
  for (let i = 0; i < n; i++) {
    const lat = latitudeNorth + (latitudeSouth - latitudeNorth) * (grid.points[2 * i + 1] / grid.height)
    const base = tEquator - 40 * (Math.abs(lat) / 90) ** 1.3
    const altitude = heightToMeters(heights[i])
    temp[i] = Math.max(-127, Math.min(127, Math.round(base - (altitude / 1000) * 6.5)))
  }
  return temp
}

/**
 * Precipitation: humid air masses travel along prevailing winds (westerlies, plus a weaker
 * north/south component), refill over water and are lost over land, mostly on windward slopes.
 */
export function computePrecipitation(grid: Grid, heights: Uint8Array, features: Features, rng: Rng) {
  const n = grid.count
  const prec = new Float32Array(n)
  const { cellsX, cellsY } = grid
  const land = (i: number) => heights[i] >= SEA_LEVEL

  const pass = (cells: number[], strength: number) => {
    let humidity = strength * 0.6
    let prevHeight = 0
    for (const i of cells) {
      if (!land(i)) {
        humidity = Math.min(strength, humidity + strength * 0.08)
        prevHeight = 0
        continue
      }
      const rise = Math.max(0, heights[i] - prevHeight)
      const drop = humidity * (0.06 + rise * 0.02) + (heights[i] > 70 ? humidity * 0.2 : 0)
      const amount = Math.min(humidity, drop)
      prec[i] += amount
      humidity -= amount * 0.7
      prevHeight = heights[i]
    }
  }

  const westerly = 1
  for (let row = 0; row < cellsY; row++) {
    const cells: number[] = []
    for (let col = 0; col < cellsX; col++) cells.push(row * cellsX + col)
    pass(cells, 100 * westerly * (0.8 + rng() * 0.4))
    pass(cells.slice().reverse(), 35 * (0.8 + rng() * 0.4))
  }
  for (let col = 0; col < cellsX; col++) {
    const cells: number[] = []
    for (let row = 0; row < cellsY; row++) cells.push(row * cellsX + col)
    pass(cells, 40 * (0.8 + rng() * 0.4))
    pass(cells.slice().reverse(), 40 * (0.8 + rng() * 0.4))
  }

  // Coastal moisture and a little smoothing.
  for (let i = 0; i < n; i++) {
    if (!land(i)) continue
    const d = features.distance[i]
    if (d <= 2) prec[i] += 8 / d
  }
  const copy = prec.slice()
  for (let i = 0; i < n; i++) {
    if (!land(i)) continue
    let sum = copy[i] * 2
    let count = 2
    for (const c of grid.neighbors[i]) {
      if (!land(c)) continue
      sum += copy[c]
      count++
    }
    prec[i] = (sum / count) * 6
  }
  return prec
}

export interface Biome {
  name: string
  color: string
  habitability: number
  /** Movement cost used by state expansion. */
  cost: number
}

export const BIOMES: Biome[] = [
  { name: 'Marine', color: '#466eab', habitability: 0, cost: 10 },
  { name: 'Hot desert', color: '#fbe79f', habitability: 4, cost: 200 },
  { name: 'Cold desert', color: '#b5b887', habitability: 10, cost: 150 },
  { name: 'Savanna', color: '#d2d082', habitability: 60, cost: 60 },
  { name: 'Grassland', color: '#c8d68f', habitability: 100, cost: 50 },
  { name: 'Tropical seasonal forest', color: '#b6d95d', habitability: 80, cost: 70 },
  { name: 'Temperate deciduous forest', color: '#29bc56', habitability: 100, cost: 70 },
  { name: 'Tropical rainforest', color: '#7dcb35', habitability: 80, cost: 80 },
  { name: 'Temperate rainforest', color: '#409c43', habitability: 90, cost: 90 },
  { name: 'Taiga', color: '#4b6b32', habitability: 12, cost: 200 },
  { name: 'Tundra', color: '#96784b', habitability: 4, cost: 1000 },
  { name: 'Glacier', color: '#d5e7eb', habitability: 0, cost: 5000 },
  { name: 'Wetland', color: '#0b9131', habitability: 12, cost: 150 },
]

// Moisture band (rows, dry -> wet) x temperature band (columns, hot -> cold), Azgaar's matrix.
const BIOME_MATRIX: number[][] = [
  [1, 1, 1, 1, 1, 1, 3, 3, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 10, 10, 10, 10, 10, 10],
  [3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10],
  [5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10],
  [5, 6, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10],
  [7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10],
]

export function assignBiomes(
  grid: Grid,
  heights: Uint8Array,
  temp: Int8Array,
  prec: Float32Array,
  flux: Float32Array,
  riverThreshold: number,
) {
  const n = grid.count
  const biomes = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (heights[i] < SEA_LEVEL) continue
    const t = temp[i]
    const hasRiver = flux[i] > riverThreshold
    const moisture = prec[i] / 5 + (hasRiver ? 4 : 0)
    if (t < -5) biomes[i] = 11
    else if (t >= 25 && !hasRiver && moisture < 8) biomes[i] = 1
    else if (moisture > 40 && t > -2 && heights[i] < 25) biomes[i] = 12
    else {
      const moistureBand = Math.min(Math.floor(moisture / 5), 4)
      const tempBand = Math.min(Math.max(20 - t, 0), 25)
      biomes[i] = BIOME_MATRIX[moistureBand][tempBand]
    }
  }
  return biomes
}
