import { describe, it, expect } from 'vitest'
import { resolveLocationName, distinctLocationNames } from './locationLabel'

const locations = [
  { id: 'loc-1', name: 'Main Office' },
  { id: 'loc-2', name: 'Site Number 1' },
]

describe('resolveLocationName', () => {
  it('resolves a known location_id to its name', () => {
    expect(resolveLocationName({ location_id: 'loc-2', custom_location: 'ignored' }, locations)).toBe('Site Number 1')
  })

  it('falls back to custom_location when there is no location_id', () => {
    expect(resolveLocationName({ location_id: null, custom_location: 'Remote Site' }, locations)).toBe('Remote Site')
  })

  it('falls back to custom_location when the location_id is not in the active list', () => {
    expect(resolveLocationName({ location_id: 'loc-gone', custom_location: 'Temp Depot' }, locations)).toBe('Temp Depot')
  })

  it('returns null when neither source resolves', () => {
    expect(resolveLocationName({ location_id: 'loc-gone', custom_location: null }, locations)).toBeNull()
    expect(resolveLocationName({ location_id: null, custom_location: '   ' }, locations)).toBeNull()
  })
})

describe('distinctLocationNames', () => {
  it('returns deduped, alphabetized names (case-insensitive)', () => {
    const items = [
      { location_id: 'loc-2', custom_location: null },
      { location_id: 'loc-1', custom_location: null },
      { location_id: 'loc-1', custom_location: null },
      { location_id: null, custom_location: 'alpha site' },
    ]
    expect(distinctLocationNames(items, locations)).toEqual(['alpha site', 'Main Office', 'Site Number 1'])
  })

  it('skips items whose location does not resolve', () => {
    const items = [
      { location_id: null, custom_location: null },
      { location_id: 'loc-gone', custom_location: '   ' },
      { location_id: 'loc-1', custom_location: null },
    ]
    expect(distinctLocationNames(items, locations)).toEqual(['Main Office'])
  })

  it('returns empty for no items', () => {
    expect(distinctLocationNames([], locations)).toEqual([])
  })
})
