import type { RequestRow } from '../data/db'
import type { LocationRef } from './locationLabel'

export interface DepartmentRef {
  id: string
  name: string
}

export interface RequestSearchContext {
  locations: LocationRef[]
  departments: DepartmentRef[]
}

// Client-side matcher for the Requests page search bar (v4 z8ygbxrhcq).
// Case-insensitive. The request number matches EXACTLY, with or without a
// leading '#' ("15" and "#15", but not "1" for #15) to avoid digit-noise;
// every other field is a substring match. A match on ANY item of the request
// is enough (the whole request is then shown, in both group-by modes).
export function matchesRequest(query: string, req: RequestRow, ctx: RequestSearchContext): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true

  if (req.request_number != null) {
    const n = String(req.request_number)
    if (q === n || q === `#${n}`) return true
  }

  if (req.requester_name?.toLowerCase().includes(q)) return true
  if (req.requester_email?.toLowerCase().includes(q)) return true

  for (const item of req.line_items ?? []) {
    if (item.item_description?.toLowerCase().includes(q)) return true
    if (item.item_url?.toLowerCase().includes(q)) return true
    if (item.memo?.toLowerCase().includes(q)) return true

    // Saved location name (resolved from the active list) with the free-text
    // custom_location as fallback — mirrors resolveLocationName's precedence.
    const loc =
      (item.location_id ? ctx.locations.find((l) => l.id === item.location_id)?.name : null) ??
      item.custom_location?.trim() ??
      null
    if (loc && loc.toLowerCase().includes(q)) return true

    const dept =
      (item.department_id ? ctx.departments.find((d) => d.id === item.department_id)?.name : null) ??
      item.custom_department?.trim() ??
      null
    if (dept && dept.toLowerCase().includes(q)) return true
  }

  return false
}
