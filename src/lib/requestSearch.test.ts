import { describe, it, expect } from 'vitest'
import { matchesRequest } from './requestSearch'
import type { RequestRow } from '../data/db'

const LOCATIONS = [
  { id: 'loc-lynch', name: 'Lynchburg 2.5 - 618 COURT ST, LYNCHBURG, VA 24504' },
  { id: 'loc-dumf', name: 'Dumfries 3.1 - 3638 MCDOWELL CT, DUMFRIES, VA, 22026' },
]
const DEPARTMENTS = [{ id: 'dep-fac', name: 'Facilities' }]

function req(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'req-1',
    requester_id: 'u1',
    requester_name: 'Nicole Smith',
    requester_email: 'nicole@example.com',
    requester_type: 'portal_user',
    status: 'pending',
    notes: 'needed for the kitchen',
    submitted_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    request_number: 15,
    line_items: [
      {
        item_description: 'Home Lights',
        item_url: 'https://example.com/lights',
        status: 'pending',
        gl_code: null,
        line_no: 1,
        location_id: 'loc-lynch',
        custom_location: null,
        department_id: 'dep-fac',
        custom_department: null,
        memo: 'two bulbs',
      },
      {
        item_description: 'Desk Chair',
        item_url: null,
        status: 'pending',
        gl_code: null,
        line_no: 2,
        location_id: null,
        custom_location: 'Warehouse - 99 Dock Rd',
        department_id: null,
        custom_department: 'Logistics',
        memo: null,
      },
    ],
    ...overrides,
  }
}

describe('matchesRequest', () => {
  it('matches everything on an empty or whitespace query', () => {
    expect(matchesRequest('', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('   ', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches the request number with or without a leading # (exact - no digit-prefix noise)', () => {
    // Items removed: the fixture addresses contain digits, and a substring
    // search for "1" legitimately matches them (location text is substring-matched).
    const bare = req({ line_items: [] })
    expect(matchesRequest('15', bare, { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('#15', bare, { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('1', bare, { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(false)
    expect(matchesRequest('5', bare, { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(false)
    expect(matchesRequest('15', req({ request_number: 155 }), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(false)
  })

  it('matches item names case-insensitively (any item in the request)', () => {
    expect(matchesRequest('home lights', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('HOME LIGHTS', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('chair', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches item URLs case-insensitively', () => {
    expect(matchesRequest('example.com/lights', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('EXAMPLE.COM', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches item memos', () => {
    expect(matchesRequest('bulbs', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches requester name and email case-insensitively', () => {
    expect(matchesRequest('nicole', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('SMITH', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('nicole@example.com', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('example.com', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches a saved location by its resolved name', () => {
    expect(matchesRequest('lynchburg', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('618 court st', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches a custom (free-text) location', () => {
    expect(matchesRequest('99 Dock Rd', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches a saved department by its resolved name', () => {
    expect(matchesRequest('facilities', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('matches a custom (free-text) department', () => {
    expect(matchesRequest('logistics', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
  })

  it('falls back to custom_location when the saved location is no longer in the active list', () => {
    const r = req({
      line_items: [
        {
          item_description: 'Old Site Item',
          item_url: null,
          status: 'pending',
          gl_code: null,
          line_no: 1,
          location_id: 'loc-gone',
          custom_location: 'Old Site',
          department_id: null,
          custom_department: null,
          memo: null,
        },
      ],
    })
    expect(matchesRequest('old site', r, { locations: [], departments: [] })).toBe(true)
  })

  it('matches a notes-only request (no items) on number and requester', () => {
    const r = req({ line_items: [] })
    expect(matchesRequest('15', r, { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('nicole', r, { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(true)
    expect(matchesRequest('lights', r, { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(false)
  })

  it('returns false when nothing matches', () => {
    expect(matchesRequest('zzz-not-here', req(), { locations: LOCATIONS, departments: DEPARTMENTS })).toBe(false)
  })
})
