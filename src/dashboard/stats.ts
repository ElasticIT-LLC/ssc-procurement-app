export interface StatusCount { status: string; count: number }
export interface MonthCount { month: string; count: number }
export interface LocationCount { location: string; count: number }

/**
 * Count rows per status, returned as a chart-friendly array. Statuses are ordered by the
 * canonical `order` list (so charts are stable); any status not in `order` is appended last.
 * Statuses that never appear are omitted.
 */
export function countByStatusList<T extends { status: string }>(rows: T[], order: readonly string[]): StatusCount[] {
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  const ordered = order.filter(s => counts[s] !== undefined).map(s => ({ status: s, count: counts[s] ?? 0 }))
  const extras = Object.keys(counts).filter(s => !order.includes(s)).map(s => ({ status: s, count: counts[s] ?? 0 }))
  return [...ordered, ...extras]
}

/**
 * Group rows into monthly counts keyed by `YYYY-MM` (sliced from the ISO `submitted_at`
 * string — no Date parsing, so timezone-safe for grouping), sorted ascending.
 */
export function requestsByMonth<T extends { submitted_at: string }>(rows: T[]): MonthCount[] {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const month = r.submitted_at.slice(0, 7)
    counts[month] = (counts[month] ?? 0) + 1
  }
  return Object.keys(counts).sort().map(month => ({ month, count: counts[month] ?? 0 }))
}

/**
 * Count line items per location for the "Items by Location" chart. A picked location
 * resolves to its name via `locationNames` (id → name); every item with a free-typed
 * location, no location, or an unknown id is grouped into a single "Other" bucket.
 * Named locations are sorted by count descending; "Other" (when present) is appended last.
 */
export function itemsByLocation(
  items: { location_id: string | null; custom_location: string | null }[],
  locationNames: Record<string, string>,
): LocationCount[] {
  const counts: Record<string, number> = {}
  let other = 0
  for (const it of items) {
    const name = it.location_id ? locationNames[it.location_id] : undefined
    if (name) counts[name] = (counts[name] ?? 0) + 1
    else other += 1
  }
  const named = Object.entries(counts)
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
  if (other > 0) named.push({ location: 'Other', count: other })
  return named
}
