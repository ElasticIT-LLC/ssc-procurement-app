import { describe, it, expect } from 'vitest'
import { countByStatusList, requestsByMonth } from './stats'

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
