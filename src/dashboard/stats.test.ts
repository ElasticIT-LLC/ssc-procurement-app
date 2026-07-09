import { describe, it, expect } from 'vitest'
import { countByStatusList, requestsByMonth, itemsByLocation } from './stats'

const items = [
  { status: 'approved' },
  { status: 'approved' },
  { status: 'pending' },
  { status: 'weird_status' },
]

describe('countByStatusList', () => {
  it('counts per status, ordered by the given canonical order, extras last', () => {
    expect(countByStatusList(items, ['pending', 'approved'])).toEqual([
      { status: 'pending', count: 1 },
      { status: 'approved', count: 2 },
      { status: 'weird_status', count: 1 },
    ])
  })
  it('omits statuses that never appear', () => {
    expect(countByStatusList([{ status: 'pending' }], ['pending', 'approved'])).toEqual([
      { status: 'pending', count: 1 },
    ])
  })
  it('handles empty input', () => expect(countByStatusList([], ['pending'])).toEqual([]))
})

describe('requestsByMonth', () => {
  it('groups by YYYY-MM ascending', () => {
    const rows = [
      { submitted_at: '2026-07-08T10:00:00Z' },
      { submitted_at: '2026-07-20T10:00:00Z' },
      { submitted_at: '2026-05-01T10:00:00Z' },
    ]
    expect(requestsByMonth(rows)).toEqual([
      { month: '2026-05', count: 1 },
      { month: '2026-07', count: 2 },
    ])
  })
  it('handles empty input', () => expect(requestsByMonth([])).toEqual([]))
})

describe('itemsByLocation', () => {
  const names = { 'loc-a': 'Warehouse A', 'loc-b': 'HQ Office' }
  it('counts items per named location; custom/blank/unknown go to Other; sorted desc, Other last', () => {
    const rows = [
      { location_id: 'loc-a', custom_location: null },
      { location_id: 'loc-a', custom_location: null },
      { location_id: 'loc-b', custom_location: null },
      { location_id: null, custom_location: 'Front desk' }, // free-typed → Other
      { location_id: null, custom_location: null },          // blank → Other
      { location_id: 'loc-x', custom_location: null },        // unknown id → Other
    ]
    expect(itemsByLocation(rows, names)).toEqual([
      { location: 'Warehouse A', count: 2 },
      { location: 'HQ Office', count: 1 },
      { location: 'Other', count: 3 },
    ])
  })
  it('omits Other when every item maps to a named location', () => {
    expect(itemsByLocation([{ location_id: 'loc-b', custom_location: null }], names)).toEqual([
      { location: 'HQ Office', count: 1 },
    ])
  })
  it('handles empty input', () => expect(itemsByLocation([], names)).toEqual([]))
})
