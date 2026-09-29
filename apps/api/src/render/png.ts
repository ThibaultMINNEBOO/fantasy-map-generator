import { initWasm, Resvg } from '@resvg/resvg-wasm'

export type PngRenderer = (svg: string, zoom: number) => Promise<Uint8Array>

/**
 * Creates a PNG rasteriser. The wasm module and font files are injected so the same code runs
 * in the Worker (bundled modules) and in Node (files read from disk).
 */
export function createPngRenderer(wasm: WebAssembly.Module | BufferSource, fonts: Uint8Array[]): PngRenderer {
  let ready: Promise<void> | null = null
  return async (svg, zoom) => {
    ready ??= initWasm(wasm)
    await ready
    const resvg = new Resvg(svg, {
      font: { fontBuffers: fonts, defaultFontFamily: 'Cinzel', serifFamily: 'Cinzel' },
      fitTo: { mode: 'zoom', value: zoom },
      shapeRendering: 2,
      textRendering: 1,
    })
    try {
      const image = resvg.render()
      try {
        return image.asPng()
      } finally {
        image.free()
      }
    } finally {
      resvg.free()
    }
  }
}
