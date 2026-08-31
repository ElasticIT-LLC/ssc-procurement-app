import { describe, expect, it } from 'vitest'
import { buildTimeline } from './timeline'
import type { LineItemRow, RequestCommentRow, RequestRow } from '../data/db'

function req(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'r1', requester_id: 'u1', requester_name: 'Jane', requester_email: 'jane@x.com',
    requester_type: 'portal_user', status: 'pending', notes: null,
    submitted_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z', request_number: 7, ...over,
  }
}
function li(over: Partial<LineItemRow> = {}): LineItemRow {
  return {
    id: 'l1', request_id: 'r1', item_description: 'Monitor', item_url: null, memo: null,
    quantity: 1, substitution_ok: false, status: 'pending', location_id: null, custom_location: null,
    ship_to_name: null, shipping_location_id: null, custom_shipping_location: null,
    department_id: null, custom_department: null, date_needed: null, eta: null, admin_comment: null,
    commented_by: null, commented_at: null, product_image_path: null, return_reason: null,
    return_quantity: null, wants_replacement: null, return_notes: null, return_date: null,
    created_at: '2026-08-01T09:00:00Z', line_no: 1, return_processed_at: null, po_id: null,
    archived_at: null, received_at: null, cancelled_at: null, pre_approved_item_id: null,
    approved_by: null, approval_date: null, date_purchased: null,
    updated_at: '2026-08-01T09:00:00Z', ...over,
  }
}
function cm(over: Partial<RequestCommentRow> = {}): RequestCommentRow {
  return {
    id: 'c1', request_id: 'r1', parent_id: null, line_item_id: null, source: 'request',
    author_id: 'u2', author_name: 'Staff', author_email: 's@x.com', author_role: 'staff',
    body: 'ok', mentioned_user_ids: [], created_at: '2026-08-02T10:00:00Z', ...over,
  }
}
const nameOf = (id: string) => (id === 'u9' ? 'J. Bugahon' : 'Unknown')
const itemName = (i: LineItemRow) => i.item_description ?? 'Item'

describe('buildTimeline', () => {
  it('always includes the submission event as the oldest', () => {
    const events = buildTimeline({ request: req(), items: [], comments: [], itemName, nameOf })
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('submitted')
    expect(events[0]!.label).toContain('#7')
  })

  it('orders newest first and interleaves comments with decisions', () => {
    const events = buildTimeline({
      request: req(),
      items: [li({ id: 'l1', status: 'approved', approval_date: '2026-08-03T12:00:00Z', approved_by: 'u9' })],
      comments: [cm({ id: 'c1', created_at: '2026-08-02T10:00:00Z' }), cm({ id: 'c2', created_at: '2026-08-04T08:00:00Z' })],
      itemName,
      nameOf,
    })
    expect(events.map((e) => e.kind)).toEqual(['comment', 'decision', 'comment', 'submitted'])
    expect(events[1]!.label).toBe('J. Bugahon approved Monitor')
  })

  it('derives ordered/received/cancelled from item status fields', () => {
    const events = buildTimeline({
      request: req({ status: 'approved' }),
      items: [
        li({ id: 'l1', status: 'received', po_id: 'po1', date_purchased: '2026-08-10', updated_at: '2026-08-20T09:00:00Z' }),
        li({ id: 'l2', item_description: 'Dock', status: 'cancelled', updated_at: '2026-08-12T09:00:00Z' }),
      ],
      comments: [],
      itemName,
      nameOf,
    })
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('ordered')
    expect(kinds).toContain('received')
    expect(kinds).toContain('cancelled')
    expect(kinds[kinds.length - 1]).toBe('submitted')
  })

  it('emits no decision event when approval_date or approved_by is missing', () => {
    const events = buildTimeline({
      request: req(),
      items: [li({ id: 'l1', status: 'approved', approval_date: null }), li({ id: 'l2', status: 'declined', approved_by: null })],
      comments: [],
      itemName,
      nameOf,
    })
    expect(events.map((e) => e.kind)).toEqual(['submitted'])
  })

  it('prefers dedicated received_at/cancelled_at stamps over updated_at', () => {
    const events = buildTimeline({
      request: req(),
      items: [
        li({ id: 'l1', status: 'received', received_at: '2026-08-21T10:00:00Z', updated_at: '2026-08-25T09:00:00Z' }),
        li({ id: 'l2', item_description: 'Dock', status: 'cancelled', cancelled_at: '2026-08-13T09:00:00Z', updated_at: '2026-08-26T09:00:00Z' }),
      ],
      comments: [],
      itemName,
      nameOf,
    })
    const byId: Record<string, string | null> = {}
    for (const e of events) byId[e.id] = e.at
    expect(byId['li-l1-received']).toBe('2026-08-21T10:00:00Z')
    expect(byId['li-l2-cancelled']).toBe('2026-08-13T09:00:00Z')
  })
})
