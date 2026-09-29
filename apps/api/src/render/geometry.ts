import type { Grid } from '../generator/grid'

/**
 * Boundary geometry shared by all layers. Cells get a "label" (ocean depth band, lake, country,
 * ...); Voronoi vertices lying on a boundary between exactly two labels are smoothed along that
 * boundary. Because every layer reads the same smoothed vertices, fills, coastlines and borders
 * always line up.
 */
export function smoothVertices(grid: Grid, label: (cell: number) => number, iterations = 3): Float64Array {
  const { vertices, vertexCells, vertexNeighbors } = grid
  const vCount = vertices.length / 2
  const next = (e: number) => (e % 3 === 2 ? e - 2 : e + 1)

  // For each boundary vertex, its two neighbours along the boundary (-1 when not smoothable).
  const nbA = new Int32Array(vCount).fill(-1)
  const nbB = new Int32Array(vCount).fill(-1)
  for (let v = 0; v < vCount; v++) {
    const la = label(vertexCells[3 * v])
    const lb = label(vertexCells[3 * v + 1])
    const lc = label(vertexCells[3 * v + 2])
    const distinct = la === lb ? (lb === lc ? 1 : 2) : la === lc || lb === lc ? 2 : 3
    if (distinct !== 2) continue
    const found: number[] = []
    for (let e = 3 * v; e < 3 * v + 3; e++) {
      if (label(vertexCells[e]) !== label(vertexCells[next(e)])) found.push(vertexNeighbors[e])
    }
    if (found.length === 2 && found[0] !== -1 && found[1] !== -1) {
      nbA[v] = found[0]
      nbB[v] = found[1]
    }
  }

  let current = Float64Array.from(vertices)
  const pass = (factor: number) => {
    const out = Float64Array.from(current)
    for (let v = 0; v < vCount; v++) {
      const a = nbA[v]
      if (a === -1) continue
      const b = nbB[v]
      const mx = (current[2 * a] + current[2 * b]) / 2
      const my = (current[2 * a + 1] + current[2 * b + 1]) / 2
      out[2 * v] = current[2 * v] + factor * (mx - current[2 * v])
      out[2 * v + 1] = current[2 * v + 1] + factor * (my - current[2 * v + 1])
    }
    current = out
  }
  // Taubin smoothing: alternate shrink / inflate steps to avoid shrinking small islands.
  for (let i = 0; i < iterations; i++) {
    pass(0.6)
    pass(-0.62)
  }
  pass(0.5)
  return current
}

/**
 * Outer (and hole) loops of every group of cells. `group` returns the group key of a cell or
 * `undefined` for cells that belong to no group. Loops are lists of vertex ids.
 */
export function regionLoops(grid: Grid, group: (cell: number) => number | undefined): Map<number, number[][]> {
  const edgesByGroup = new Map<number, [number, number][]>()
  for (let c = 0; c < grid.count; c++) {
    const g = group(c)
    if (g === undefined) continue
    const verts = grid.cellVertices[c]
    const nbs = grid.cellEdgeNeighbors[c]
    const len = verts.length
    for (let k = 0; k < len; k++) {
      const nb = nbs[k]
      if (nb < grid.count && group(nb) === g) continue
      let list = edgesByGroup.get(g)
      if (!list) edgesByGroup.set(g, (list = []))
      list.push([verts[(k - 1 + len) % len], verts[k]])
    }
  }
  const result = new Map<number, number[][]>()
  for (const [g, edges] of edgesByGroup) result.set(g, chainDirected(edges))
  return result
}

function chainDirected(edges: [number, number][]): number[][] {
  const byStart = new Map<number, number[]>()
  edges.forEach(([a], i) => {
    const list = byStart.get(a)
    if (list) list.push(i)
    else byStart.set(a, [i])
  })
  const used = new Uint8Array(edges.length)
  const loops: number[][] = []
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const start = edges[i][0]
    const loop = [start]
    let cur = edges[i][1]
    while (cur !== start) {
      loop.push(cur)
      const candidates = byStart.get(cur)
      const nextEdge = candidates?.find((e) => !used[e])
      if (nextEdge === undefined) break
      used[nextEdge] = 1
      cur = edges[nextEdge][1]
    }
    if (loop.length > 2) loops.push(loop)
  }
  return loops
}

/**
 * Open polylines along the boundaries between cells for which `isBoundary(a, b)` is true.
 * Only edges between two real cells are considered.
 */
export function boundaryChains(grid: Grid, isBoundary: (a: number, b: number) => boolean): number[][] {
  const edges: [number, number][] = []
  for (let c = 0; c < grid.count; c++) {
    const verts = grid.cellVertices[c]
    const nbs = grid.cellEdgeNeighbors[c]
    const len = verts.length
    for (let k = 0; k < len; k++) {
      const nb = nbs[k]
      if (nb >= grid.count || nb < c || !isBoundary(c, nb)) continue
      edges.push([verts[(k - 1 + len) % len], verts[k]])
    }
  }

  const adjacency = new Map<number, number[]>()
  const add = (v: number, e: number) => {
    const list = adjacency.get(v)
    if (list) list.push(e)
    else adjacency.set(v, [e])
  }
  edges.forEach(([a, b], i) => {
    add(a, i)
    add(b, i)
  })

  const used = new Uint8Array(edges.length)
  const chains: number[][] = []
  const walk = (start: number, firstEdge: number) => {
    const chain = [start]
    let v = start
    let e = firstEdge
    while (true) {
      used[e] = 1
      const [a, b] = edges[e]
      v = a === v ? b : a
      chain.push(v)
      const around = adjacency.get(v)!
      if (around.length !== 2) break
      const nextEdge = around.find((x) => !used[x])
      if (nextEdge === undefined) break
      e = nextEdge
    }
    chains.push(chain)
  }

  for (const [v, around] of adjacency) {
    if (around.length === 2) continue
    for (const e of around) if (!used[e]) walk(v, e)
  }
  for (let i = 0; i < edges.length; i++) if (!used[i]) walk(edges[i][0], i)
  return chains
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString()

export function pathFromLoops(loops: number[][], coords: Float64Array): string {
  let d = ''
  for (const loop of loops) {
    d += `M${fmt(coords[2 * loop[0]])} ${fmt(coords[2 * loop[0] + 1])}`
    for (let i = 1; i < loop.length; i++) d += `L${fmt(coords[2 * loop[i]])} ${fmt(coords[2 * loop[i] + 1])}`
    d += 'Z'
  }
  return d
}

export function pathFromChains(chains: number[][], coords: Float64Array): string {
  let d = ''
  for (const chain of chains) {
    d += `M${fmt(coords[2 * chain[0]])} ${fmt(coords[2 * chain[0] + 1])}`
    for (let i = 1; i < chain.length; i++) d += `L${fmt(coords[2 * chain[i]])} ${fmt(coords[2 * chain[i] + 1])}`
  }
  return d
}

export function pathFromPoints(points: [number, number][], closed = false): string {
  if (!points.length) return ''
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`
  for (let i = 1; i < points.length; i++) d += `L${fmt(points[i][0])} ${fmt(points[i][1])}`
  return closed ? `${d}Z` : d
}

/** Chaikin corner cutting on an open polyline (endpoints kept). */
export function chaikin<T extends number[]>(points: T[], iterations = 2): T[] {
  let pts = points
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts
    const out: T[] = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]
      const q = pts[i + 1]
      out.push(p.map((v, k) => 0.75 * v + 0.25 * q[k]) as T, p.map((v, k) => 0.25 * v + 0.75 * q[k]) as T)
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}
