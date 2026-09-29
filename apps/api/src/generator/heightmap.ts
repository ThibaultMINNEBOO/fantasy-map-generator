import { findGridCell, type Grid } from './grid'
import { chance, fromRange, probabilisticCount, randFloat, type Rng } from './random'

/**
 * Heightmap tools ported from Azgaar's HeightmapGenerator. Heights range from 0 to 100,
 * sea level is 20.
 */
export const SEA_LEVEL = 20

type Step =
  | ['hill' | 'pit' | 'range' | 'trough', count: string, height: string, rangeX: string, rangeY: string]
  | ['strait', width: string, direction: 'vertical' | 'horizontal']
  | ['mask', power: number]
  | ['smooth', factor: number]
  | ['add', value: number, target: 'land' | 'all']
  | ['multiply', value: number, target: 'land' | 'all']

export const TEMPLATES = {
  continents: [
    ['hill', '1', '80-85', '60-80', '40-60'],
    ['hill', '1', '80-85', '20-30', '40-60'],
    ['hill', '6-7', '15-30', '25-75', '15-85'],
    ['multiply', 0.6, 'land'],
    ['hill', '8-10', '5-10', '15-85', '20-80'],
    ['range', '1-2', '30-60', '5-15', '25-75'],
    ['range', '1-2', '30-60', '80-95', '25-75'],
    ['range', '0-3', '30-60', '80-90', '20-80'],
    ['strait', '2', 'vertical'],
    ['strait', '1', 'vertical'],
    ['smooth', 3],
    ['trough', '3-4', '15-20', '15-85', '20-80'],
    ['trough', '3-4', '5-10', '45-55', '45-55'],
    ['pit', '3-4', '10-20', '15-85', '20-80'],
    ['mask', 4],
  ],
  pangea: [
    ['hill', '1-2', '25-40', '15-50', '0-10'],
    ['hill', '1-2', '5-40', '50-85', '0-10'],
    ['hill', '1-2', '25-40', '50-85', '90-100'],
    ['hill', '1-2', '5-40', '15-50', '90-100'],
    ['hill', '8-12', '20-40', '20-80', '48-52'],
    ['smooth', 2],
    ['multiply', 0.7, 'land'],
    ['trough', '3-4', '25-35', '5-95', '10-20'],
    ['trough', '3-4', '25-35', '5-95', '80-90'],
    ['range', '5-6', '30-40', '10-90', '35-65'],
    ['mask', 3],
  ],
  archipelago: [
    ['add', 11, 'all'],
    ['range', '2-3', '40-60', '20-80', '20-80'],
    ['hill', '5', '15-20', '10-90', '30-70'],
    ['hill', '2', '10-15', '10-30', '20-80'],
    ['hill', '2', '10-15', '60-90', '20-80'],
    ['smooth', 3],
    ['trough', '10', '20-30', '5-95', '5-95'],
    ['strait', '2', 'vertical'],
    ['strait', '2', 'horizontal'],
  ],
  island: [
    ['hill', '1', '90-100', '65-75', '47-53'],
    ['add', 7, 'all'],
    ['hill', '5-6', '20-30', '25-55', '45-55'],
    ['range', '1', '40-50', '45-55', '45-55'],
    ['multiply', 0.8, 'land'],
    ['mask', 3],
    ['smooth', 2],
    ['trough', '2-3', '20-30', '20-30', '20-30'],
    ['trough', '2-3', '20-30', '60-80', '70-80'],
    ['hill', '1', '10-15', '60-60', '50-50'],
    ['hill', '1.5', '13-16', '15-20', '20-75'],
    ['range', '1.5', '30-40', '15-85', '30-40'],
    ['range', '1.5', '30-40', '15-85', '60-70'],
    ['pit', '3-5', '10-30', '15-85', '20-80'],
  ],
  peninsula: [
    ['range', '2-3', '20-35', '40-50', '0-15'],
    ['add', 5, 'all'],
    ['hill', '1', '90-100', '10-90', '0-5'],
    ['add', 13, 'all'],
    ['hill', '3-4', '3-5', '5-95', '80-100'],
    ['hill', '1-2', '3-5', '5-95', '40-60'],
    ['trough', '5-6', '10-25', '5-95', '5-95'],
    ['smooth', 3],
    ['mask', 2],
  ],
  mediterranean: [
    ['range', '4-6', '30-80', '0-100', '0-10'],
    ['range', '4-6', '30-80', '0-100', '90-100'],
    ['hill', '6-8', '30-50', '10-90', '0-5'],
    ['hill', '6-8', '30-50', '10-90', '95-100'],
    ['multiply', 0.9, 'land'],
    ['mask', -2],
    ['smooth', 1],
    ['hill', '2-3', '30-70', '0-5', '20-80'],
    ['hill', '2-3', '30-70', '95-100', '20-80'],
    ['trough', '3-6', '40-50', '0-100', '0-10'],
    ['trough', '3-6', '40-50', '0-100', '90-100'],
  ],
} satisfies Record<string, Step[]>

export type TemplateName = keyof typeof TEMPLATES
export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[]

const lim = (v: number) => Math.max(0, Math.min(100, v))

function interpolatePower(cells: number, table: [number, number][]): number {
  if (cells <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [c1, p1] = table[i]
    const [c0, p0] = table[i - 1]
    if (cells <= c1) return p0 + ((p1 - p0) * (cells - c0)) / (c1 - c0)
  }
  return table[table.length - 1][1]
}

const BLOB_POWER: [number, number][] = [
  [1000, 0.93], [2000, 0.95], [5000, 0.97], [10000, 0.98], [20000, 0.99], [30000, 0.991], [50000, 0.993],
]
const LINE_POWER: [number, number][] = [
  [1000, 0.75], [2000, 0.77], [5000, 0.79], [10000, 0.81], [20000, 0.82], [30000, 0.83], [50000, 0.86],
]

export function generateHeightmap(grid: Grid, template: TemplateName, rng: Rng): Uint8Array {
  const n = grid.count
  const { width, height, neighbors } = grid
  const heights = new Float32Array(n)
  const blobPower = interpolatePower(n, BLOB_POWER)
  const linePower = interpolatePower(n, LINE_POWER)
  const cx = (i: number) => grid.points[2 * i]
  const cy = (i: number) => grid.points[2 * i + 1]
  const pointInRange = (range: string, length: number) => {
    const [a, b] = range.split('-').map(Number)
    const min = (a / 100) * length
    const max = ((b ?? a) / 100) * length
    return randFloat(rng, min, max)
  }

  const addHill = (heightRange: string, rangeX: string, rangeY: string) => {
    const change = new Uint8Array(n)
    const h = lim(fromRange(rng, heightRange))
    let start = 0
    let limit = 0
    do {
      start = findGridCell(grid, pointInRange(rangeX, width), pointInRange(rangeY, height))
      limit++
    } while (heights[start] + h > 90 && limit < 50)

    change[start] = h
    const queue = [start]
    for (let qi = 0; qi < queue.length; qi++) {
      const q = queue[qi]
      for (const c of neighbors[q]) {
        if (change[c]) continue
        change[c] = change[q] ** blobPower * (rng() * 0.2 + 0.9)
        if (change[c] > 1) queue.push(c)
      }
    }
    for (let i = 0; i < n; i++) heights[i] = lim(heights[i] + change[i])
  }

  const addPit = (heightRange: string, rangeX: string, rangeY: string) => {
    const used = new Uint8Array(n)
    let h = lim(fromRange(rng, heightRange))
    let start = 0
    let limit = 0
    do {
      start = findGridCell(grid, pointInRange(rangeX, width), pointInRange(rangeY, height))
      limit++
    } while (heights[start] < SEA_LEVEL && limit < 50)

    const queue = [start]
    for (let qi = 0; qi < queue.length; qi++) {
      const q = queue[qi]
      h = h ** blobPower * (rng() * 0.2 + 0.9)
      if (h < 1) return
      for (const c of neighbors[q]) {
        if (used[c]) continue
        heights[c] = lim(heights[c] - h * (rng() * 0.2 + 0.9))
        used[c] = 1
        queue.push(c)
      }
    }
  }

  /** Greedy walk from start to end, sometimes wandering off the straight line. */
  const walk = (start: number, end: number, used: Uint8Array, wander: number) => {
    const path = [start]
    let cur = start
    used[cur] = 1
    const ex = cx(end)
    const ey = cy(end)
    while (cur !== end) {
      let min = Infinity
      let next = -1
      for (const e of neighbors[cur]) {
        if (used[e]) continue
        let diff = (ex - cx(e)) ** 2 + (ey - cy(e)) ** 2
        if (rng() > wander) diff /= 2
        if (diff < min) {
          min = diff
          next = e
        }
      }
      if (next === -1) break
      cur = next
      path.push(cur)
      used[cur] = 1
    }
    return path
  }

  const addRangeOrTrough = (sign: 1 | -1, heightRange: string, rangeX: string, rangeY: string) => {
    const used = new Uint8Array(n)
    let h = lim(fromRange(rng, heightRange))
    let startX = 0
    let startY = 0
    let start = 0
    let limit = 0
    do {
      startX = pointInRange(rangeX, width)
      startY = pointInRange(rangeY, height)
      start = findGridCell(grid, startX, startY)
      limit++
    } while (sign === -1 && heights[start] < SEA_LEVEL && limit < 50)

    let endX = 0
    let endY = 0
    limit = 0
    let dist = 0
    do {
      endX = rng() * width * 0.8 + width * 0.1
      endY = rng() * height * 0.7 + height * 0.15
      dist = Math.abs(endY - startY) + Math.abs(endX - startX)
      limit++
    } while ((dist < width / 8 || dist > width / 2) && limit < 50)

    const ridge = walk(start, findGridCell(grid, endX, endY), used, 0.85)

    let queue = ridge.slice()
    let depth = 0
    while (queue.length) {
      const frontier = queue
      queue = []
      depth++
      for (const i of frontier) heights[i] = lim(heights[i] + sign * h * (rng() * 0.3 + 0.85))
      h = h ** linePower - 1
      if (h < 2) break
      for (const f of frontier) {
        for (const i of neighbors[f]) {
          if (used[i]) continue
          queue.push(i)
          used[i] = 1
        }
      }
    }

    // Prominences (ranges) or sinks (troughs) along the ridge.
    ridge.forEach((cell, d) => {
      if (d % 6 !== 0) return
      let cur = cell
      for (let l = 0; l < depth; l++) {
        let best = -1
        for (const c of neighbors[cur]) {
          if (best === -1 || sign * heights[c] < sign * heights[best]) best = c
        }
        if (best === -1) break
        heights[best] = (heights[cur] * 2 + heights[best]) / 3
        cur = best
      }
    })
  }

  const addStrait = (widthRange: string, direction: 'vertical' | 'horizontal') => {
    let w = Math.min(fromRange(rng, widthRange), grid.cellsX / 3)
    if (w < 1 && chance(rng, w)) return
    const used = new Uint8Array(n)
    const vert = direction === 'vertical'
    const startX = vert ? Math.floor(rng() * width * 0.4 + width * 0.3) : 5
    const startY = vert ? 5 : Math.floor(rng() * height * 0.4 + height * 0.3)
    const endX = vert ? Math.floor(width - startX - width * 0.1 + rng() * width * 0.2) : width - 5
    const endY = vert ? height - 5 : Math.floor(height - startY - height * 0.1 + rng() * height * 0.2)
    let range = walk(findGridCell(grid, startX, startY), findGridCell(grid, endX, endY), new Uint8Array(n), 0.8)

    const step = 0.1 / w
    const query: number[] = []
    while (w > 0) {
      const exp = 0.9 - step * w
      for (const r of range) {
        for (const e of neighbors[r]) {
          if (used[e]) continue
          used[e] = 1
          query.push(e)
          heights[e] = heights[e] ** exp
          if (heights[e] > 100) heights[e] = 5
        }
      }
      range = query.slice()
      w--
    }
  }

  const mask = (power: number) => {
    const fr = power ? Math.abs(power) : 1
    for (let i = 0; i < n; i++) {
      const nx = (2 * cx(i)) / width - 1
      const ny = (2 * cy(i)) / height - 1
      let distance = (1 - nx ** 2) * (1 - ny ** 2)
      if (power < 0) distance = 1 - distance
      const masked = heights[i] * distance
      heights[i] = lim((heights[i] * (fr - 1) + masked) / fr)
    }
  }

  const smooth = (fr: number) => {
    const copy = heights.slice()
    for (let i = 0; i < n; i++) {
      let sum = copy[i]
      for (const c of neighbors[i]) sum += copy[c]
      const mean = sum / (neighbors[i].length + 1)
      heights[i] = lim((copy[i] * (fr - 1) + mean) / fr)
    }
  }

  const modify = (target: 'land' | 'all', add: number, mult: number) => {
    const land = target === 'land'
    for (let i = 0; i < n; i++) {
      let h = heights[i]
      if (land && h < SEA_LEVEL) continue
      h += add
      if (mult !== 1) h = land ? (h - SEA_LEVEL) * mult + SEA_LEVEL : h * mult
      heights[i] = lim(h)
    }
  }

  for (const step of TEMPLATES[template] as Step[]) {
    switch (step[0]) {
      case 'hill':
      case 'pit':
      case 'range':
      case 'trough': {
        const [tool, countRange, h, rx, ry] = step
        const count = probabilisticCount(rng, fromRange(rng, countRange))
        for (let i = 0; i < count; i++) {
          if (tool === 'hill') addHill(h, rx, ry)
          else if (tool === 'pit') addPit(h, rx, ry)
          else addRangeOrTrough(tool === 'range' ? 1 : -1, h, rx, ry)
        }
        break
      }
      case 'strait':
        addStrait(step[1], step[2])
        break
      case 'mask':
        mask(step[1])
        break
      case 'smooth':
        smooth(step[1])
        break
      case 'add':
        modify(step[2], step[1], 1)
        break
      case 'multiply':
        modify(step[2], 0, step[1])
        break
    }
  }

  return Uint8Array.from(heights, (h) => Math.round(h))
}
