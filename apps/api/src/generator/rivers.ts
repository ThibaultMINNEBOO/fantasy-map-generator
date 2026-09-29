import type { Grid } from './grid'
import { SEA_LEVEL } from './heightmap'
import { FeatureType, type Features } from './physical'

export interface River {
  /** Cell ids from source to mouth (the last one is a water cell). */
  cells: number[]
  /** Accumulated flux at each cell of the path. */
  flux: number[]
}

export interface Hydrology {
  /** Accumulated water flux per cell. */
  flux: Float32Array
  /** Downstream cell of each land cell (-1 for water cells). */
  downstream: Int32Array
  rivers: River[]
  threshold: number
}

/** Minimal binary min-heap keyed by a numeric priority. */
export class MinHeap {
  private items: number[] = []
  private prio: number[] = []
  get size() {
    return this.items.length
  }
  push(item: number, priority: number) {
    const { items, prio } = this
    let i = items.length
    items.push(item)
    prio.push(priority)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (prio[p] <= priority) break
      items[i] = items[p]
      prio[i] = prio[p]
      i = p
    }
    items[i] = item
    prio[i] = priority
  }
  pop(): [item: number, priority: number] {
    const { items, prio } = this
    const topItem = items[0]
    const topPrio = prio[0]
    const lastItem = items.pop()!
    const lastPrio = prio.pop()!
    const len = items.length
    if (len) {
      let i = 0
      while (true) {
        const l = 2 * i + 1
        if (l >= len) break
        const r = l + 1
        const c = r < len && prio[r] < prio[l] ? r : l
        if (prio[c] >= lastPrio) break
        items[i] = items[c]
        prio[i] = prio[c]
        i = c
      }
      items[i] = lastItem
      prio[i] = lastPrio
    }
    return [topItem, topPrio]
  }
}

/**
 * Drainage using priority-flood depression filling: every land cell gets a downstream cell
 * leading to the ocean or a lake. Flux accumulates precipitation downstream.
 */
export function computeHydrology(
  grid: Grid,
  heights: Uint8Array,
  features: Features,
  prec: Float32Array,
  riverDensity: number,
): Hydrology {
  const n = grid.count
  const isLand = (i: number) => heights[i] >= SEA_LEVEL
  const filled = new Float32Array(n)
  const visited = new Uint8Array(n)
  const downstream = new Int32Array(n).fill(-1)
  const heap = new MinHeap()

  for (let i = 0; i < n; i++) {
    if (isLand(i)) continue
    visited[i] = 1
    filled[i] = heights[i]
    if (features.distance[i] === -1) heap.push(i, SEA_LEVEL - 1)
  }
  // Land cells on the map edge drain out of the map.
  for (let i = 0; i < n; i++) {
    if (isLand(i) && grid.isBorder[i] && !visited[i]) {
      visited[i] = 1
      filled[i] = heights[i]
      heap.push(i, heights[i])
    }
  }

  const order: number[] = []
  while (heap.size) {
    const [c] = heap.pop()
    for (const nb of grid.neighbors[c]) {
      if (visited[nb]) continue
      visited[nb] = 1
      filled[nb] = Math.max(heights[nb], (isLand(c) ? filled[c] : SEA_LEVEL - 1) + 0.01)
      downstream[nb] = c
      order.push(nb)
      heap.push(nb, filled[nb])
    }
  }

  // Prefer the steepest descent when several lower neighbours exist.
  for (const c of order) {
    let best = downstream[c]
    for (const nb of grid.neighbors[c]) {
      const target = isLand(nb) ? filled[nb] : -1
      const current = isLand(best) ? filled[best] : -1
      if (target < current) best = nb
    }
    downstream[c] = best
  }

  const flux = new Float32Array(n)
  for (let i = 0; i < n; i++) if (isLand(i)) flux[i] = prec[i]
  const byHeight = order.slice().sort((a, b) => filled[b] - filled[a])
  for (const c of byHeight) {
    const d = downstream[c]
    if (d !== -1 && isLand(d)) flux[d] += flux[c]
  }

  // Threshold scaled so that river density does not depend on the cells count.
  const cellsFactor = Math.sqrt(n / 10000)
  const threshold = (700 * cellsFactor) / Math.max(riverDensity, 0.05)

  const isRiver = (i: number) => isLand(i) && flux[i] > threshold
  const hasRiverUpstream = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const d = downstream[i]
    if (isRiver(i) && d !== -1) hasRiverUpstream[d] = 1
  }

  const sources: number[] = []
  for (let i = 0; i < n; i++) if (isRiver(i) && !hasRiverUpstream[i]) sources.push(i)
  sources.sort((a, b) => filled[b] - filled[a])

  const traced = new Uint8Array(n)
  const rivers: River[] = []
  for (const source of sources) {
    const cells: number[] = []
    let cur = source
    while (cur !== -1) {
      cells.push(cur)
      if (!isLand(cur) || traced[cur]) break
      traced[cur] = 1
      if (grid.isBorder[cur] && downstream[cur] === -1) break
      cur = downstream[cur]
    }
    if (cells.length < 3) continue
    rivers.push({ cells, flux: cells.map((c) => (isLand(c) ? flux[c] : flux[cells[cells.length - 2]])) })
  }

  // Lakes collect the rivers flowing into them.
  for (let i = 0; i < n; i++) if (features.type[i] === FeatureType.Lake) flux[i] = 0

  return { flux, downstream, rivers, threshold }
}
