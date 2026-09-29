import { Delaunay } from 'd3-delaunay'
import type { Rng } from './random'

/**
 * Voronoi graph built on a jittered square grid (same approach as Azgaar's generator).
 *
 * Extra "boundary" points are placed outside the canvas so that every real cell is a closed
 * polygon made of Delaunay circumcenters. A Voronoi vertex is therefore identified by its
 * triangle index, which lets several layers share exactly the same vertices.
 */
export interface Grid {
  width: number
  height: number
  spacing: number
  cellsX: number
  cellsY: number
  /** Number of real cells (boundary points are stored after them). */
  count: number
  /** x/y interleaved coordinates for all points (real + boundary). */
  points: Float64Array
  /** Neighbour cell ids (real cells only) of every real cell. */
  neighbors: number[][]
  /** Polygon of each real cell as a list of vertex ids, in rotation order. */
  cellVertices: number[][]
  /**
   * For each cell, the cell on the other side of the polygon edge that ends at cellVertices[i][k]
   * (edge from vertex k-1 to vertex k). May be a boundary point id (>= count).
   */
  cellEdgeNeighbors: number[][]
  /** True when the cell touches the outer boundary. */
  isBorder: Uint8Array
  /** x/y interleaved coordinates of Voronoi vertices (one per Delaunay triangle). */
  vertices: Float64Array
  /** The three cells around each vertex. */
  vertexCells: Uint32Array
  /** The three neighbouring vertices of each vertex (-1 when missing). */
  vertexNeighbors: Int32Array
  delaunay: Delaunay<number>
}

export function buildGrid(width: number, height: number, cellsDesired: number, rng: Rng): Grid {
  const spacing = Math.sqrt((width * height) / cellsDesired)
  const cellsX = Math.max(1, Math.floor((width + 0.5 * spacing - 1e-10) / spacing))
  const cellsY = Math.max(1, Math.floor((height + 0.5 * spacing - 1e-10) / spacing))
  const radius = (spacing / 2) * 0.9

  const coords: number[] = []
  for (let row = 0; row < cellsY; row++) {
    const y = spacing / 2 + row * spacing
    for (let col = 0; col < cellsX; col++) {
      const x = spacing / 2 + col * spacing
      const jx = x + (rng() * 2 - 1) * radius
      const jy = y + (rng() * 2 - 1) * radius
      coords.push(Math.min(Math.max(jx, 0), width), Math.min(Math.max(jy, 0), height))
    }
  }
  const count = coords.length / 2

  // Boundary points, outside the canvas.
  const offset = -spacing
  const bSpacing = spacing * 2
  const w = width - offset * 2
  const h = height - offset * 2
  const nx = Math.ceil(w / bSpacing) - 1
  const ny = Math.ceil(h / bSpacing) - 1
  for (let i = 0.5; i < nx; i++) {
    const x = Math.ceil((w * i) / nx + offset)
    coords.push(x, offset, x, h + offset)
  }
  for (let i = 0.5; i < ny; i++) {
    const y = Math.ceil((h * i) / ny + offset)
    coords.push(offset, y, w + offset, y)
  }

  const points = Float64Array.from(coords)
  const delaunay = new Delaunay(points)
  const { triangles, halfedges, inedges } = delaunay

  const triCount = triangles.length / 3
  const vertices = new Float64Array(triCount * 2)
  for (let t = 0; t < triCount; t++) {
    const a = triangles[3 * t] * 2
    const b = triangles[3 * t + 1] * 2
    const c = triangles[3 * t + 2] * 2
    const [cx, cy] = circumcenter(points[a], points[a + 1], points[b], points[b + 1], points[c], points[c + 1])
    vertices[2 * t] = cx
    vertices[2 * t + 1] = cy
  }

  const vertexCells = new Uint32Array(triangles)
  const vertexNeighbors = new Int32Array(triCount * 3)
  for (let e = 0; e < triangles.length; e++) {
    const opposite = halfedges[e]
    vertexNeighbors[e] = opposite === -1 ? -1 : Math.floor(opposite / 3)
  }

  const neighbors: number[][] = new Array(count)
  const cellVertices: number[][] = new Array(count)
  const cellEdgeNeighbors: number[][] = new Array(count)
  const isBorder = new Uint8Array(count)

  for (let i = 0; i < count; i++) {
    const verts: number[] = []
    const edgeNeighbors: number[] = []
    const start = inedges[i]
    let incoming = start
    do {
      verts.push(Math.floor(incoming / 3))
      edgeNeighbors.push(triangles[incoming])
      const outgoing = incoming % 3 === 2 ? incoming - 2 : incoming + 1
      incoming = halfedges[outgoing]
    } while (incoming !== -1 && incoming !== start)

    cellVertices[i] = verts
    cellEdgeNeighbors[i] = edgeNeighbors
    const real: number[] = []
    for (const n of edgeNeighbors) {
      if (n < count) real.push(n)
      else isBorder[i] = 1
    }
    neighbors[i] = real
  }

  return {
    width,
    height,
    spacing,
    cellsX,
    cellsY,
    count,
    points,
    neighbors,
    cellVertices,
    cellEdgeNeighbors,
    isBorder,
    vertices,
    vertexCells,
    vertexNeighbors,
    delaunay,
  }
}

function circumcenter(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number] {
  const ad = ax * ax + ay * ay
  const bd = bx * bx + by * by
  const cd = cx * cx + cy * cy
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(D) < 1e-12) return [(ax + bx + cx) / 3, (ay + by + cy) / 3]
  return [
    (ad * (by - cy) + bd * (cy - ay) + cd * (ay - by)) / D,
    (ad * (cx - bx) + bd * (ax - cx) + cd * (bx - ax)) / D,
  ]
}

/** Fast lookup of the grid cell under a point (approximate: uses the underlying square grid). */
export function findGridCell(grid: Grid, x: number, y: number): number {
  const col = Math.min(Math.max(Math.floor(x / grid.spacing), 0), grid.cellsX - 1)
  const row = Math.min(Math.max(Math.floor(y / grid.spacing), 0), grid.cellsY - 1)
  return row * grid.cellsX + col
}

/** Exact lookup of the nearest real cell. */
export function findCell(grid: Grid, x: number, y: number, hint = 0): number {
  const cell = grid.delaunay.find(x, y, hint)
  return cell < grid.count ? cell : findGridCell(grid, x, y)
}

export const cellX = (grid: Grid, i: number) => grid.points[2 * i]
export const cellY = (grid: Grid, i: number) => grid.points[2 * i + 1]
