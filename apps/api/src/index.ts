import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import alegreya from '../assets/fonts/AlegreyaSC-Regular.ttf'
import cinzelBold from '../assets/fonts/Cinzel-Bold.ttf'
import cinzel from '../assets/fonts/Cinzel-Regular.ttf'
import { createApp } from './app'
import { createPngRenderer } from './render/png'

const fonts = [cinzelBold, cinzel, alegreya].map((f) => new Uint8Array(f))

export default createApp({ renderPng: createPngRenderer(resvgWasm, fonts) })
