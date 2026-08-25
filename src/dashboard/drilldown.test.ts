import { describe, it, expect } from 'vitest'
import {
  filterRequestsByStatus,
  filterRequestsByMonth,
  filterItemsByStatus,
  filterItemsByLocation,
  myPendingRequests,
} from './drilldown'
import type { RequestRow, LineItemDetailed } from '../data/db'

const req = (over: Partial<RequestRow>): RequestRow => ({
  id: 'r1', requester_id: 'u1', requester_name: 'Jane', requester_email: 'jane@x.com',
  requester_type: 'portal_user', status: 'pending', notes: null,
  submitted_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-01T10:00:00.000Z',
  request_number: 1, ...over,
})

const item = (over: Partial<LineItemDetailed>): LineItemDetailed => ({
  id: 'i1', request_id: 'r1', item_description: 'Monitor', item_url: null, memo: null,
  quantity: 1, status: 'pending', location_id: null, custom_location: null, department_id: null,
  custom_department: null, date_needed: null, eta: null, admin_comment: null, commented_by: null,
  commented_at: null, product_image_path: null, return_reason: null, return_quantity: null,
  wants_replacement: null, return_notes: null, return_date: null,
  created_at: '2026-08-01T10:00:00.000Z', line_no: 1, return_processed_at: null, po_id: null,
  substitution_ok: true,
  request: { id: 'r1', request_number: 1, requester_name: 'Jane', requester_email: 'jane@x.com', notes: null, submitted_at: '2026-08-01T10:00:00.000Z', status: 'pending' },
  location: null, department: null,
  ...over,
})

describe('filterRequestsByStatus', () => {
  it('returns only requests with the given status', () => {
    const rows = [req({ status: 'pending' }), req({ id: 'r2', status: 'approved' })]
    expect(filterRequestsByStatus(rows, 'pending').map(r => r.id)).toEqual(['r1'])
  })
})

describe('filterRequestsByMonth', () => {
  it('buckets by YYYY-MM of submitted_at', () => {
    const rows = [
      req({ submitted_at: '2026-08-15T10:00:00.000Z' }),
      req({ id: 'r2', submitted_at: '2026-07-15T10:00:00.000Z' }),
    ]
    expect(filterRequestsByMonth(rows, '2026-08').map(r => r.id)).toEqual(['r1'])
    expect(filterRequestsByMonth(rows, '2026-07').map(r => r.id)).toEqual(['r2'])
  })
})

describe('filterItemsByStatus', () => {
  it('returns items in any of the given statuses', () => {
    const rows = [item({}), item({ id: 'i2', status: 'approved' })]
    expect(filterItemsByStatus(rows, ['pending', 'on_hold']).map(i => i.id)).toEqual(['i1'])
    expect(filterItemsByStatus(rows, ['pending', 'approved']).map(i => i.id).sort()).toEqual(['i1', 'i2'])
  })
})

describe('filterItemsByLocation', () => {
  const names = { locA: 'HQ', locB: 'Branch' }
  it('matches named locations by resolved name', () => {
    const rows = [item({ location_id: 'locA' }), item({ id: 'i2', location_id: 'locB' })]
    expect(filterItemsByLocation(rows, names, 'HQ').map(i => i.id)).toEqual(['i1'])
  })
  it("'Other' captures null/unknown locations", () => {
    const rows = [
      item({ location_id: null }),
      item({ id: 'i2', location_id: 'locA' }),
      item({ id: 'i3', location_id: 'missing' }),
    ]
    expect(filterItemsByLocation(rows, names, 'Other').map(i => i.id).sort()).toEqual(['i1', 'i3'])
  })
})

describe('myPendingRequests', () => {
  it('keeps only pending requests owned by the user (id or anon email)', () => {
    const rows = [
      req({}),
      req({ id: 'r2', status: 'approved' }),
      req({ id: 'r3', requester_id: null, requester_email: 'jane@x.com' }),
      req({ id: 'r4', requester_id: 'someone-else', requester_email: null }),
    ]
    expect(myPendingRequests(rows, 'u1', 'jane@x.com').map(r => r.id).sort()).toEqual(['r1', 'r3'])
  })
})
