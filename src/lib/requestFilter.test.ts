import { describe, it, expect } from 'vitest'
import { countByStatus, filterByStatus } from './requestFilter'

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
