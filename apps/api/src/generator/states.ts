import type { Grid } from './grid'
import { SEA_LEVEL } from './heightmap'
import { BIOMES, type Features } from './physical'
import { MinHeap, type Hydrology } from './rivers'
import { randFloat, type Rng } from './random'

export class GenerationError extends Error {}

/** Settlement suitability of every land cell (0 for water). */
export function computeSuitability(
  grid: Grid,
  heights: Uint8Array,
  features: Features,
  biomes: Uint8Array,
  hydrology: Hydrology,
): Float32Array {
  const n = grid.count
  const suitability = new Float32Array(n)
  const { flux, threshold } = hydrology
  for (let i = 0; i < n; i++) {
    if (heights[i] < SEA_LEVEL) continue
    let s = BIOMES[biomes[i]].habitability
    if (!s) continue
    if (flux[i] > threshold) s += Math.min(Math.sqrt(flux[i] / threshold) * 15, 60)
    if (features.distance[i] === 1) s += 20
    s -= (heights[i] - 50) / 5
    suitability[i] = Math.max(s, 1)
  }
  return suitability
}

/** Picks well spaced, highly suitable capitals. */
export function placeCapitals(grid: Grid, suitability: Float32Array, count: number, rng: Rng): number[] {
  const candidates: { cell: number; score: number }[] = []
  for (let i = 0; i < grid.count; i++) {
    if (suitability[i] > 0) candidates.push({ cell: i, score: suitability[i] * randFloat(rng, 0.5, 1) })
  }
  if (candidates.length < count) {
    throw new GenerationError(
      `Not enough land for ${count} countries (${candidates.length} habitable cells). ` +
        'Use fewer countries, more cells or another template.',
    )
  }
  candidates.sort((a, b) => b.score - a.score)

  let spacing = (grid.width + grid.height) / 2 / Math.sqrt(count) / 1.3
  for (let attempt = 0; attempt < 60; attempt++) {
    const chosen: number[] = []
    for (const { cell } of candidates) {
      const x = grid.points[2 * cell]
      const y = grid.points[2 * cell + 1]
      let ok = true
      for (const c of chosen) {
        if ((grid.points[2 * c] - x) ** 2 + (grid.points[2 * c + 1] - y) ** 2 < spacing * spacing) {
          ok = false
          break
        }
      }
      if (!ok) continue
      chosen.push(cell)
      if (chosen.length === count) return chosen
    }
    spacing *= 0.88
  }
  return candidates.slice(0, count).map((c) => c.cell)
}

/**
 * Grows states from their capitals with a Dijkstra-like expansion (Azgaar's approach):
 * crossing water, mountains or hostile biomes is expensive, rivers are natural borders.
 * Returns the state index of each cell (-1 for water and unclaimed land).
 */
export function expandStates(
  grid: Grid,
  heights: Uint8Array,
  features: Features,
  biomes: Uint8Array,
  hydrology: Hydrology,
  capitals: number[],
  expansionism: number[],
  neutralDistance: number,
): Int16Array {
  const n = grid.count
  const state = new Int16Array(n).fill(-1)
  const cost = new Float64Array(n).fill(Infinity)
  const owner = new Int16Array(n).fill(-1)
  const nativeBiome = capitals.map((c) => biomes[c])
  const heap = new MinHeap()
  // Normalise costs so the neutral limit does not depend on the cells count.
  const cellsFactor = Math.sqrt(10000 / n)
  const limit = neutralDistance > 0 ? neutralDistance * 20000 * cellsFactor : Infinity

  capitals.forEach((c, s) => {
    state[c] = s
    owner[c] = s
    cost[c] = 0
    heap.push(c, 0)
  })

  while (heap.size) {
    const [cell, p] = heap.pop()
    if (p > cost[cell]) continue
    const s = owner[cell]
    for (const e of grid.neighbors[cell]) {
      const h = heights[e]
      let cellCost: number
      if (h < SEA_LEVEL) {
        // Naval expansion: cheap along the coast, expensive in open sea.
        cellCost = features.distance[e] === -1 ? 400 : 1500
      } else {
        const biomeCost = biomes[e] === nativeBiome[s] ? 10 : BIOMES[biomes[e]].cost
        const heightCost = h >= 67 ? 2200 : h >= 44 ? 300 : 0
        const riverCost = hydrology.flux[e] > hydrology.threshold ? Math.min(Math.sqrt(hydrology.flux[e]), 100) : 0
        cellCost = biomeCost + heightCost + riverCost
      }
      const total = p + (10 + cellCost / expansionism[s]) * cellsFactor
      if (total > limit || total >= cost[e]) continue
      cost[e] = total
      owner[e] = s
      if (h >= SEA_LEVEL) state[e] = s
      heap.push(e, total)
    }
  }

  // Remove single-cell enclaves, they look like noise.
  for (let i = 0; i < n; i++) {
    if (state[i] === -1 || capitals.includes(i)) continue
    const counts = new Map<number, number>()
    let same = 0
    let land = 0
    for (const c of grid.neighbors[i]) {
      if (heights[c] < SEA_LEVEL) continue
      land++
      if (state[c] === state[i]) same++
      else counts.set(state[c], (counts.get(state[c]) ?? 0) + 1)
    }
    if (same === 0 && land > 1) {
      let best = state[i]
      let bestCount = 0
      for (const [s, cnt] of counts) {
        if (s !== -1 && cnt > bestCount) {
          best = s
          bestCount = cnt
        }
      }
      state[i] = best
    }
  }

  return state
}

/** Chooses city cells inside each state, well spaced and away from the capital. */
export function placeCities(
  grid: Grid,
  state: Int16Array,
  suitability: Float32Array,
  capitals: number[],
  citiesPerState: number[],
  rng: Rng,
): number[][] {
  const byState: { cell: number; score: number }[][] = capitals.map(() => [])
  for (let i = 0; i < grid.count; i++) {
    const s = state[i]
    if (s < 0 || !suitability[i] || capitals[s] === i) continue
    byState[s].push({ cell: i, score: suitability[i] * randFloat(rng, 0.4, 1) })
  }

  return capitals.map((capital, s) => {
    const wanted = citiesPerState[s]
    if (!wanted) return []
    const candidates = byState[s].sort((a, b) => b.score - a.score)
    const area = candidates.length + 1
    let spacing = Math.max(grid.spacing * 1.5, (Math.sqrt(area / (wanted + 1)) * grid.spacing) / 1.2)
    for (let attempt = 0; attempt < 30; attempt++) {
      const chosen: number[] = []
      const taken = [capital]
      for (const { cell } of candidates) {
        const x = grid.points[2 * cell]
        const y = grid.points[2 * cell + 1]
        const tooClose = taken.some((c) => (grid.points[2 * c] - x) ** 2 + (grid.points[2 * c + 1] - y) ** 2 < spacing * spacing)
        if (tooClose) continue
        chosen.push(cell)
        taken.push(cell)
        if (chosen.length === wanted) return chosen
      }
      if (spacing <= grid.spacing * 1.2) return chosen
      spacing = Math.max(grid.spacing * 1.2, spacing * 0.8)
    }
    return []
  })
}
