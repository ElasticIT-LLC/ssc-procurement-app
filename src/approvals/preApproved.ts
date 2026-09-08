import type { PreApprovedItem } from '../data/db'

export const OTHER = '__other__'

export interface PreApprovedOrderDraft {
  name: string
  item_url: string
  quantity: number
  substitution_ok: boolean
  date_needed: string
  memo: string
  ship_to_name: string
  location_id: string
  custom_location: string
  department_id: string
  custom_department: string
}

// Pre-fill the New Purchase dialog from a catalog entry (spec B3: all fields
// editable). ship_to_name is intentionally not stored on the catalog, so it
// always starts empty. A catalog entry stored with a custom location/department
// opens with the "Other" sentinel selected so the custom text is visible.
export function prefillFromCatalog(item: PreApprovedItem | null): PreApprovedOrderDraft {
  return {
    name: item?.name ?? '',
    item_url: item?.item_url ?? '',
    quantity: item?.quantity ?? 1,
    substitution_ok: item?.substitution_ok ?? false,
    date_needed: item?.date_needed ?? '',
    memo: item?.memo ?? '',
    ship_to_name: '',
    location_id: item?.location_id ?? (item?.custom_location ? OTHER : ''),
    custom_location: item?.custom_location ?? '',
    department_id: item?.department_id ?? (item?.custom_department ? OTHER : ''),
    custom_department: item?.custom_department ?? '',
  }
}

// Maps the dialog draft to the exact p_* arguments of order_pre_approved_item.
// Empty/whitespace-only text becomes null so the RPC falls back to catalog
// values (name/url) or stores NULL (the rest).
export function draftToRpcPayload(d: PreApprovedOrderDraft): Record<string, unknown> {
  const trimOrNull = (s: string) => (s.trim() === '' ? null : s.trim())
  const isLocOther = d.location_id === OTHER
  const isDeptOther = d.department_id === OTHER
  return {
    p_name: trimOrNull(d.name),
    p_item_url: trimOrNull(d.item_url),
    p_quantity: Math.max(1, Math.floor(d.quantity || 0)),
    p_ship_to_name: trimOrNull(d.ship_to_name),
    p_location_id: isLocOther ? null : d.location_id || null,
    p_custom_location: isLocOther ? trimOrNull(d.custom_location) : null,
    p_department_id: isDeptOther ? null : d.department_id || null,
    p_custom_department: isDeptOther ? trimOrNull(d.custom_department) : null,
    p_date_needed: d.date_needed || null,
    p_memo: trimOrNull(d.memo),
    p_substitution_ok: d.substitution_ok,
  }
}
