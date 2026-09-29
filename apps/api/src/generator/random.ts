/** Seeded pseudo-random generator: xmur3 string hash feeding an sfc32 generator. */
export type Rng = () => number

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}

/**
 * Creates an independent stream for `seed` + `stream`. Every generation stage uses its own
 * stream so that changing one stage's inputs (e.g. number of cities) never shifts another.
 */
export function createRng(seed: string, stream = ''): Rng {
  const hash = xmur3(`${seed}::${stream}`)
  let a = hash()
  let b = hash()
  let c = hash()
  let d = hash()
  const next = () => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 12; i++) next()
  return next
}

export function randomSeed(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(buf[0] % 1_000_000_000).padStart(9, '0')
}

/** Random float in [min, max). */
export const randFloat = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

/** Random integer in [min, max]. */
export const randInt = (rng: Rng, min: number, max: number) => Math.floor(min + rng() * (max - min + 1))

/** Returns true with probability p. */
export const chance = (rng: Rng, p: number) => (p >= 1 ? true : p <= 0 ? false : rng() < p)

/** Parses "a-b" or "a" ranges (Azgaar template notation) and returns a random value. */
export function fromRange(rng: Rng, range: string | number): number {
  if (typeof range === 'number') return range
  const [a, b] = range.split('-').map(Number)
  if (b === undefined || Number.isNaN(b)) return a
  return randFloat(rng, a, b)
}

/** Converts fractional counts like 1.5 into 1 or 2 (probabilistically). */
export function probabilisticCount(rng: Rng, value: number): number {
  const base = Math.floor(value)
  return base + (chance(rng, value - base) ? 1 : 0)
}
