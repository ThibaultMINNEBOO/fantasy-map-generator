import { findCell, type Grid } from './grid'

/** Base font sizes (px at a 1200 px reference size) shared by the generator and the renderer. */
export const SETTLEMENT_FONT = 12
export const CAPITAL_FONT = 13.8
export const CAPITAL_RADIUS = 3.6
export const CITY_RADIUS = 2.3

/** Axis-aligned box [minX, minY, maxX, maxY] that labels should avoid. */
export type Box = [number, number, number, number]

const intersects = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

export interface LabelLayout {
  x: number
  y: number
  fontSize: number
  lines: string[]
}

/** Returns the width of `text` in em. */
export type Measure = (text: string) => number

/** Splits a name in one or two balanced lines. */
function lineOptions(name: string): string[][] {
  const words = name.trim().split(/\s+/)
  const options = [[words.join(' ')]]
  if (words.length > 1) {
    let best: string[] | null = null
    let bestDiff = Infinity
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ')
      const b = words.slice(i).join(' ')
      const diff = Math.abs(a.length - b.length)
      if (diff < bestDiff) {
        bestDiff = diff
        best = [a, b]
      }
    }
    if (best) options.push(best)
  }
  return options
}

/**
 * Places a region label (e.g. a country name) at the spot where the biggest text fits:
 * candidates are the most "interior" cells, then the horizontal/vertical extent of the
 * region around each candidate bounds the font size.
 */
export function placeRegionLabel(
  grid: Grid,
  owner: ArrayLike<number>,
  region: number,
  cells: number[],
  name: string,
  measure: Measure,
  minFont: number,
  maxFont: number,
  obstacles: Box[] = [],
  bounds: Box = [0, 0, grid.width, grid.height],
): LabelLayout | null {
  if (!cells.length) return null

  // Distance (in cells) from the region border, by multi-source BFS.
  const dist = new Map<number, number>()
  let frontier: number[] = []
  for (const c of cells) {
    if (grid.isBorder[c] || grid.neighbors[c].some((nb) => owner[nb] !== region)) {
      dist.set(c, 1)
      frontier.push(c)
    }
  }
  if (!frontier.length) {
    dist.set(cells[0], 1)
    frontier.push(cells[0])
  }
  for (let d = 2; frontier.length; d++) {
    const next: number[] = []
    for (const f of frontier) {
      for (const nb of grid.neighbors[f]) {
        if (owner[nb] !== region || dist.has(nb)) continue
        dist.set(nb, d)
        next.push(nb)
      }
    }
    frontier = next
  }

  const candidates = cells
    .slice()
    .sort((a, b) => (dist.get(b) ?? 0) - (dist.get(a) ?? 0) || a - b)
    .slice(0, 40)

  const step = grid.spacing / 3
  const inside = (x: number, y: number, hint: number) =>
    x >= 0 && y >= 0 && x <= grid.width && y <= grid.height && owner[findCell(grid, x, y, hint)] === region

  const extent = (x: number, y: number, dx: number, dy: number, hint: number) => {
    let d = 0
    // Tolerate one "miss" to cross thin rivers of another owner.
    let misses = 0
    while (d < Math.max(grid.width, grid.height)) {
      const nd = d + step
      if (!inside(x + dx * nd, y + dy * nd, hint)) {
        if (++misses > 1) break
      } else misses = 0
      d = nd
    }
    return Math.max(d - misses * step, step)
  }

  const options = lineOptions(name)
  let best: (LabelLayout & { score: number; collides: boolean; em: number }) | null = null
  const labelBox = (x: number, y: number, em: number, lineCount: number, fontSize: number): Box => {
    const halfW = (em * fontSize) / 2
    const halfH = (lineCount * 1.15 * fontSize) / 2
    return [x - halfW, y - halfH, x + halfW, y + halfH]
  }
  const blocked = (box: Box) =>
    box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3] || obstacles.some((o) => intersects(box, o))
  for (const c of candidates) {
    let x = grid.points[2 * c]
    let y = grid.points[2 * c + 1]
    const left = extent(x, y, -1, 0, c)
    const right = extent(x, y, 1, 0, c)
    x += (right - left) / 2
    const up = extent(x, y, 0, -1, c)
    const down = extent(x, y, 0, 1, c)
    y += (down - up) / 2
    const w = left + right
    const h = up + down

    for (const lines of options) {
      const em = Math.max(...lines.map(measure), 0.1)
      let fontSize = Math.min((w * 0.8) / em, (h * 0.75) / (lines.length * 1.15), maxFont)
      // Shrink until the label no longer covers a settlement, or give up with a penalty.
      let collides = true
      while (fontSize >= minFont) {
        collides = blocked(labelBox(x, y, em, lines.length, fontSize))
        if (!collides) break
        fontSize *= 0.9
      }
      fontSize = Math.max(fontSize, minFont)
      // Slightly prefer single lines, strongly avoid collisions.
      const score = fontSize * (lines.length === 1 ? 1.12 : 1) * (collides ? 0.3 : 1)
      if (!best || score > best.score) best = { x, y, fontSize, lines, score, collides, em }
    }
  }

  // Small regions: look around for free space (the label may then slightly overflow the region).
  if (best?.collides) {
    const { em, lines, fontSize } = best
    search: for (let radius = fontSize * 0.6; radius < fontSize * 8; radius += fontSize * 0.6) {
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2
        const x = best.x + Math.cos(angle) * radius * 1.6
        const y = best.y + Math.sin(angle) * radius
        if (!blocked(labelBox(x, y, em, lines.length, fontSize))) {
          best = { ...best, x, y, collides: false }
          break search
        }
      }
    }
  }

  if (!best) return null
  obstacles.push(labelBox(best.x, best.y, best.em, best.lines.length, best.fontSize))
  return { x: best.x, y: best.y, fontSize: Math.round(best.fontSize * 10) / 10, lines: best.lines }
}

export interface PointLabel {
  /** Text anchor position (baseline). */
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  fontSize: number
}

export interface PointLabelInput {
  x: number
  y: number
  radius: number
  name: string | null
  fontSize: number
}

/**
 * Greedy placement of settlement labels: tries above, below, right and left of the marker and
 * keeps the first spot that stays inside `bounds` and does not overlap markers or other labels.
 * Returns the placed labels and every occupied box (markers + labels).
 */
export function placePointLabels(
  points: PointLabelInput[],
  bounds: Box,
  measure: Measure,
): { labels: (PointLabel | null)[]; boxes: Box[] } {
  const boxes: Box[] = points.map(({ x, y, radius }) => [x - radius * 1.4, y - radius * 1.4, x + radius * 1.4, y + radius * 1.4])
  const labels = points.map(({ x, y, radius, name, fontSize: f }): PointLabel | null => {
    if (!name) return null
    const w = measure(name) * f
    const gap = radius + f * 0.25
    const options: (PointLabel & { box: Box })[] = [
      { x, y: y - gap - f * 0.25, anchor: 'middle', fontSize: f, box: [x - w / 2, y - gap - f * 1.05, x + w / 2, y - gap] },
      { x, y: y + gap + f * 0.8, anchor: 'middle', fontSize: f, box: [x - w / 2, y + gap, x + w / 2, y + gap + f * 1.05] },
      { x: x + gap, y: y + f * 0.35, anchor: 'start', fontSize: f, box: [x + gap, y - f * 0.55, x + gap + w, y + f * 0.5] },
      { x: x - gap, y: y + f * 0.35, anchor: 'end', fontSize: f, box: [x - gap - w, y - f * 0.55, x - gap, y + f * 0.5] },
    ]
    let best = options[0]
    let bestCost = Infinity
    for (const option of options) {
      const { box } = option
      const outside = box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3]
      const overlaps = boxes.reduce((n, b) => n + (intersects(box, b) ? 1 : 0), 0)
      const cost = overlaps + (outside ? 10 : 0)
      if (cost < bestCost) {
        best = option
        bestCost = cost
        if (cost === 0) break
      }
    }
    boxes.push(best.box)
    const { box: _, ...label } = best
    return label
  })
  return { labels, boxes }
}
