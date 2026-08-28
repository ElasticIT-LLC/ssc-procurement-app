import { describe, it, expect } from 'vitest'
import { prefillFromCatalog, draftToRpcPayload, OTHER, type PreApprovedOrderDraft } from './preApproved'
import type { PreApprovedItem } from '../data/db'

const catalogItem: PreApprovedItem = {
  id: 'cat-1',
  name: 'Standing Desks',
  item_url: 'https://example.com/desk',
  quantity: 4,
  substitution_ok: true,
  date_needed: '2026-09-15',
  memo: 'Second floor',
  location_id: 'loc-1',
  custom_location: null,
  department_id: 'dept-1',
  custom_department: null,
  created_by: 'user-1',
  created_at: '2026-08-20T12:00:00.000Z',
  source_line_item_id: 'li-9',
}

function draft(partial: Partial<PreApprovedOrderDraft> = {}): PreApprovedOrderDraft {
  return {
    name: 'Standing Desks',
    item_url: 'https://example.com/desk',
    quantity: 4,
    substitution_ok: true,
    date_needed: '2026-09-15',
    memo: 'Second floor',
    ship_to_name: 'Jane Doe',
    location_id: 'loc-1',
    custom_location: '',
    department_id: 'dept-1',
    custom_department: '',
    ...partial,
  }
}

describe('prefillFromCatalog', () => {
  it('prefills every editable field from the catalog entry; ship-to starts empty', () => {
    expect(prefillFromCatalog(catalogItem)).toEqual({
      name: 'Standing Desks',
      item_url: 'https://example.com/desk',
      quantity: 4,
      substitution_ok: true,
      date_needed: '2026-09-15',
      memo: 'Second floor',
      ship_to_name: '',
      location_id: 'loc-1',
      custom_location: '',
      department_id: 'dept-1',
      custom_department: '',
    })
  })

  it('falls back to empty defaults when there is no catalog entry', () => {
    expect(prefillFromCatalog(null)).toEqual({
      name: '', item_url: '', quantity: 1, substitution_ok: false, date_needed: '', memo: '',
      ship_to_name: '', location_id: '', custom_location: '', department_id: '', custom_department: '',
    })
  })

  it('selects the Other sentinel when the catalog entry stored a custom location/department', () => {
    const d = prefillFromCatalog({
      ...catalogItem,
      location_id: null, custom_location: 'HQ Annex',
      department_id: null, custom_department: 'Facilities',
    })
    expect(d.location_id).toBe(OTHER)
    expect(d.custom_location).toBe('HQ Annex')
    expect(d.department_id).toBe(OTHER)
    expect(d.custom_department).toBe('Facilities')
  })
})

describe('draftToRpcPayload', () => {
  it('passes selected ids through and trims text fields', () => {
    expect(draftToRpcPayload(draft({ name: '  Standing Desks  ', memo: ' second floor ' }))).toEqual({
      p_name: 'Standing Desks',
      p_item_url: 'https://example.com/desk',
      p_quantity: 4,
      p_ship_to_name: 'Jane Doe',
      p_location_id: 'loc-1',
      p_custom_location: null,
      p_department_id: 'dept-1',
      p_custom_department: null,
      p_date_needed: '2026-09-15',
      p_memo: 'second floor',
      p_substitution_ok: true,
    })
  })

  it('maps the Other sentinel to null id + trimmed custom text', () => {
    const p = draftToRpcPayload(draft({
      location_id: OTHER, custom_location: '  Dock 2 ',
      department_id: OTHER, custom_department: 'Ops',
    }))
    expect(p.p_location_id).toBeNull()
    expect(p.p_custom_location).toBe('Dock 2')
    expect(p.p_department_id).toBeNull()
    expect(p.p_custom_department).toBe('Ops')
  })

  it('converts empty/whitespace-only strings to null', () => {
    const p = draftToRpcPayload(draft({ name: '   ', item_url: '  ', ship_to_name: '  ', memo: '', date_needed: '' }))
    expect(p.p_name).toBeNull()
    expect(p.p_item_url).toBeNull()
    expect(p.p_ship_to_name).toBeNull()
    expect(p.p_memo).toBeNull()
    expect(p.p_date_needed).toBeNull()
  })

  it('floors quantity and clamps to a minimum of 1', () => {
    expect(draftToRpcPayload(draft({ quantity: 0 })).p_quantity).toBe(1)
    expect(draftToRpcPayload(draft({ quantity: -5 })).p_quantity).toBe(1)
    expect(draftToRpcPayload(draft({ quantity: 2.9 })).p_quantity).toBe(2)
  })

  it('passes substitution_ok through unchanged', () => {
    expect(draftToRpcPayload(draft({ substitution_ok: true })).p_substitution_ok).toBe(true)
    expect(draftToRpcPayload(draft({ substitution_ok: false })).p_substitution_ok).toBe(false)
  })
})
