import { describe, it, expect } from 'vitest'
import { displayRequestStatus } from './requestDisplay'

describe('displayRequestStatus', () => {
  it('shows Received when a single approved item is received', () => {
    expect(displayRequestStatus({ status: 'approved', line_items: [{ status: 'received' }] })).toBe('received')
  })

  it('stays Approved when the item is only ordered (not received yet)', () => {
    expect(displayRequestStatus({ status: 'approved', line_items: [{ status: 'ordered' }] })).toBe('approved')
  })

  it('shows Received when every item is received or declined/cancelled and one is received', () => {
    expect(displayRequestStatus({ status: 'approved', line_items: [{ status: 'received' }, { status: 'declined' }] })).toBe('received')
  })

  it('stays Partially Approved when some items are still pending', () => {
    expect(displayRequestStatus({ status: 'partially_approved', line_items: [{ status: 'received' }, { status: 'pending' }] })).toBe('partially_approved')
  })

  it('stays Approved while a return is in flight (returned is not received)', () => {
    expect(displayRequestStatus({ status: 'approved', line_items: [{ status: 'received' }, { status: 'returned' }] })).toBe('approved')
  })

  it('leaves the status unchanged when there are no items', () => {
    expect(displayRequestStatus({ status: 'pending', line_items: [] })).toBe('pending')
    expect(displayRequestStatus({ status: 'pending', line_items: undefined })).toBe('pending')
  })

  it('leaves pending requests unchanged', () => {
    expect(displayRequestStatus({ status: 'pending', line_items: [{ status: 'pending' }] })).toBe('pending')
  })
})
