import { describe, it, expect } from 'vitest'
import { countByStatus, filterByStatus, filterByTab, countByTab, RECEIVED_TAB } from './requestFilter'

const rows = [
  { id: 'a', status: 'pending' },
  { id: 'b', status: 'approved' },
  { id: 'c', status: 'approved' },
]

describe('countByStatus', () => {
  it('counts each status plus all', () => {
    expect(countByStatus(rows)).toEqual({ all: 3, pending: 1, approved: 2 })
  })
  it('handles empty', () => expect(countByStatus([])).toEqual({ all: 0 }))
})

describe('filterByStatus', () => {
  it('filters by status', () => expect(filterByStatus(rows, 'approved').length).toBe(2))
  it('returns all for "all"', () => expect(filterByStatus(rows, 'all').length).toBe(3))
})

const tabRows = [
  { id: 'a', status: 'approved', line_items: [{ status: 'received' }] },
  { id: 'b', status: 'approved', line_items: [{ status: 'ordered' }] },
  { id: 'c', status: 'partially_approved', line_items: [{ status: 'received' }, { status: 'pending' }] },
]

describe('filterByTab / countByTab (Received tab)', () => {
  it('filters received = any line item received', () => {
    expect(filterByTab(tabRows, RECEIVED_TAB).map((r) => r.id)).toEqual(['a', 'c'])
  })
  it('falls back to exact status match for status tabs', () => {
    expect(filterByTab(tabRows, 'approved').map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('returns all for "all"', () => expect(filterByTab(tabRows, 'all')).toHaveLength(3))
  it('counts the received tab alongside rollup statuses', () => {
    expect(countByTab(tabRows)).toMatchObject({ all: 3, approved: 2, partially_approved: 1, [RECEIVED_TAB]: 2 })
  })
  it('treats rows without line_items as not received', () => {
    expect(filterByTab([{ id: 'x', status: 'approved' }], RECEIVED_TAB)).toHaveLength(0)
  })
})
