import { describe, it, expect } from 'vitest'
import { filterRecords, recordSearchText } from './recordsFilter'
import type { LineItemDetailed } from '../data/db'

function makeRow(overrides: Partial<LineItemDetailed> = {}): LineItemDetailed {
  return {
    id: 'li-1',
    request_id: 'req-1',
    item_description: 'Widget',
    item_url: 'https://example.com/widget',
    memo: null,
    quantity: 1,
    substitution_ok: false,
    status: 'pending',
    location_id: null,
    custom_location: null,
    department_id: null,
    custom_department: null,
    date_needed: null,
    eta: null,
    admin_comment: null,
    commented_by: null,
    commented_at: null,
    product_image_path: null,
    return_reason: null,
    return_quantity: null,
    wants_replacement: null,
    return_notes: null,
    return_date: null,
    created_at: '2026-08-27T00:00:00Z',
    line_no: 1,
    return_processed_at: null,
    po_id: null,
    archived_at: null,
    received_at: null,
    cancelled_at: null,
    pre_approved_item_id: null,
    approved_by: null,
    approval_date: null,
    date_purchased: null,
    updated_at: '2026-08-27T00:00:00Z',
    request: {
      id: 'req-1',
      request_number: 34,
      requester_name: 'Jane Doe',
      requester_email: 'jane@example.com',
      notes: null,
      submitted_at: '2026-08-01T00:00:00Z',
      status: 'pending',
    },
    location: null,
    department: null,
    po: null,
    preApproved: null,
    ...overrides,
  }
}

describe('recordSearchText', () => {
  it('includes item description, requester, request number, po number, status, location, department', () => {
    const row = makeRow({
      po: { po_number: 'PO-2026-0008' },
      location: { name: 'Main Store' },
      department: { name: 'Operations' },
      custom_location: 'Main Store',
      custom_department: 'Operations',
    })
    const text = recordSearchText(row)
    expect(text).toContain('widget')
    expect(text).toContain('jane doe')
    expect(text).toContain('req-34')
    expect(text).toContain('po-2026-0008')
    expect(text).toContain('pending')
    expect(text).toContain('main store')
    expect(text).toContain('operations')
  })

  it('falls back to custom location/department when location/department objects are null', () => {
    const row = makeRow({ custom_location: 'Dock 7', custom_department: 'Warehouse' })
    const text = recordSearchText(row)
    expect(text).toContain('dock 7')
    expect(text).toContain('warehouse')
  })
})

describe('filterRecords', () => {
  const rows = [
    makeRow({ id: 'li-1', item_description: 'Widget' }),
    makeRow({ id: 'li-2', item_description: 'Widget Pro', item_url: 'https://example.com/widget-pro', request: { ...makeRow().request, request_number: 55, requester_email: 'jane2@example.com' } }),
    makeRow({ id: 'li-3', item_description: 'Gadget', item_url: 'https://example.com/gadget', po: { po_number: 'PO-2026-0009' }, request: { ...makeRow().request, requester_email: 'jane3@example.com' } }),
  ]

  it('returns all rows for empty or whitespace keyword', () => {
    expect(filterRecords(rows, '')).toHaveLength(3)
    expect(filterRecords(rows, '   ')).toHaveLength(3)
  })

  it('matches item description case-insensitively', () => {
    const result = filterRecords(rows, 'wIdGeT')
    expect(result.map((r) => r.id)).toEqual(['li-1', 'li-2'])
  })

  it('matches request number', () => {
    expect(filterRecords(rows, 'req-55').map((r) => r.id)).toEqual(['li-2'])
    expect(filterRecords(rows, '55').map((r) => r.id)).toEqual(['li-2'])
  })

  it('matches PO number case-insensitively', () => {
    expect(filterRecords(rows, 'po-2026-0009').map((r) => r.id)).toEqual(['li-3'])
  })

  it('matches requester email', () => {
    expect(filterRecords(rows, 'JANE@example.com').map((r) => r.id)).toEqual(['li-1'])
  })

  it('returns empty array when nothing matches', () => {
    expect(filterRecords(rows, 'zzz-no-match')).toEqual([])
  })
})
