import { describe, expect, it } from 'vitest'
import { generateMap, type MapOptions } from '../src/generator'
import { TEMPLATE_NAMES } from '../src/generator/heightmap'
import { renderSvg } from '../src/render/svg'

const base: MapOptions = {
  seed: 'test-seed',
  width: 1200,
  height: 800,
  cells: 4000,
  template: 'continents',
  countries: [{ name: 'Aldoria' }, { name: 'Brevonne' }, { name: 'Castelmor' }, { name: 'Dunmar' }],
  latitudeNorth: 60,
  latitudeSouth: 15,
  riverDensity: 1,
  neutralDistance: 0,
}

/** Everything geometric about a map, without names. */
const geometry = (options: MapOptions) => {
  const map = generateMap(options)
  return {
    heights: Array.from(map.heights),
    state: Array.from(map.state),
    capitals: map.countries.map((c) => [c.capital.x, c.capital.y]),
    rivers: map.hydrology.rivers.map((r) => r.cells),
  }
}

describe('generateMap', () => {
  it('is deterministic for a given seed', () => {
    expect(geometry(base)).toEqual(geometry(base))
  })

  it('does not change the geography when countries are renamed', () => {
    const renamed = {
      ...base,
      countries: [
        { name: 'Un nom beaucoup plus long', capital: 'Capitale' },
        { name: 'X' },
        { name: 'Terres Brûlées' },
        { name: 'Ω' },
      ],
    }
    expect(geometry(renamed)).toEqual(geometry(base))
  })

  it('keeps borders when cities are added', () => {
    const withCities = { ...base, countries: base.countries.map((c) => ({ ...c, cities: ['Lysse', 'Brumeval'] })) }
    expect(geometry(withCities).state).toEqual(geometry(base).state)
  })

  it('changes with the seed', () => {
    expect(geometry({ ...base, seed: 'other' }).heights).not.toEqual(geometry(base).heights)
  })

  it.each(TEMPLATE_NAMES)('gives every country some land with the %s template', (template) => {
    const map = generateMap({ ...base, template })
    for (const country of map.countries) {
      expect(country.cells.length).toBeGreaterThan(0)
      expect(map.state[country.capital.cell]).toBe(country.index)
    }
  })

  it('assigns all land to countries when neutral lands are disabled', () => {
    const map = generateMap(base)
    for (let i = 0; i < map.grid.count; i++) {
      if (map.heights[i] >= 20) expect(map.state[i]).toBeGreaterThanOrEqual(0)
    }
  })

  it('places requested cities inside their country', () => {
    const map = generateMap({ ...base, countries: [{ name: 'Solo', capital: 'Cap', cities: ['A', 'B', 'C'] }] })
    const [country] = map.countries
    expect(country.cities.map((c) => c.name)).toEqual(['A', 'B', 'C'])
    for (const city of country.cities) expect(map.state[city.cell]).toBe(0)
  })

  it('renders exactly the given names, escaped', () => {
    const map = generateMap({ ...base, countries: [{ name: 'Rock & <Roll>', capital: "L'Aube" }, { name: 'Brevonne' }] })
    const svg = renderSvg(map, { style: 'political', labels: true, cities: true, rivers: true, relief: true, borders: true, frame: true, webFonts: false })
    expect(svg).toContain('Rock &amp; &lt;Roll&gt;')
    expect(svg).toContain('L&apos;Aube')
    expect(svg).not.toContain('<Roll>')
  })
})
