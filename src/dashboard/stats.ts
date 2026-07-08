export interface StatusCount { status: string; count: number }
export interface MonthCount { month: string; count: number }

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
