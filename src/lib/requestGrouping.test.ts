import { describe, it, expect } from 'vitest'
import { flattenToItemRows } from './requestGrouping'
import type { RequestRow } from '../data/db'

function req(id: string, number: number, items: Array<{ name: string | null; loc?: string | null }>): RequestRow {
  return {
    id,
    requester_id: 'u1',
    requester_name: 'Nicole Smith',
    requester_email: 'nicole@example.com',
    requester_type: 'portal_user',
    status: 'pending',
    notes: null,
    submitted_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    request_number: number,
    line_items: items.map((it, i) => ({
      item_description: it.name,
      item_url: null,
      status: 'pending',
      gl_code: null,
      line_no: i + 1,
      location_id: null,
      custom_location: it.loc ?? null,
      department_id: null,
      custom_department: null,
      memo: null,
    })),
  }
}

describe('flattenToItemRows', () => {
  it('produces one row per item, preserving request order and within-request item order', () => {
    const r1 = req('req-a', 15, [{ name: 'home lights', loc: 'Lynchburg' }, { name: 'desk chair' }])
    const r2 = req('req-b', 16, [{ name: 'lamp' }])
    const rows = flattenToItemRows([r1, r2])
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.item.item_description)).toEqual(['home lights', 'desk chair', 'lamp'])
    expect(rows.map((r) => r.request.id)).toEqual(['req-a', 'req-a', 'req-b'])
    expect(rows.map((r) => r.lineIndex)).toEqual([0, 1, 0])
  })

  it('preserves the request reference on each row (request-level properties stay reachable)', () => {
    const r1 = req('req-a', 15, [{ name: 'home lights' }])
    const rows = flattenToItemRows([r1])
    expect(rows[0]!.request).toBe(r1)
    expect(rows[0]!.request.requester_name).toBe('Nicole Smith')
    expect(rows[0]!.request.request_number).toBe(15)
  })

  it('returns an empty array for an empty request list', () => {
    expect(flattenToItemRows([])).toEqual([])
  })

  it('produces no rows for requests without line_items (undefined or empty)', () => {
    const undefinedItems = { ...req('req-a', 15, [{ name: 'x' }]), line_items: undefined }
    const emptyItems = req('req-b', 16, [])
    const withItem = req('req-c', 17, [{ name: 'lamp' }])
    const rows = flattenToItemRows([undefinedItems, emptyItems, withItem])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.request.id).toBe('req-c')
  })

  it('generates unique, stable keys of the form <requestId>:<lineIndex>', () => {
    const rows = flattenToItemRows([
      req('req-a', 15, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
      req('req-b', 16, [{ name: 'd' }]),
    ])
    expect(rows.map((r) => r.key)).toEqual(['req-a:0', 'req-a:1', 'req-a:2', 'req-b:0'])
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('keeps items whose name is blank (the row view falls back to a placeholder in the UI)', () => {
    const rows = flattenToItemRows([req('req-a', 15, [{ name: null }, { name: '' }, { name: 'x' }])])
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.item.item_description)).toEqual([null, '', 'x'])
  })
})
