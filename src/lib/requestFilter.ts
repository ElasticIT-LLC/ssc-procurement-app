interface HasStatus { status: string }

/** Count rows per status value, plus an `all` total. */
export function countByStatus<T extends HasStatus>(rows: T[]): Record<string, number> {
  const counts: Record<string, number> = { all: rows.length }
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  return counts
}

/** Filter rows by a status value; the sentinel `all` returns everything. */
export function filterByStatus<T extends HasStatus>(rows: T[], status: string): T[] {
  return status === 'all' ? rows : rows.filter((r) => r.status === status)
}

// z8ygbxr035: the segment filter gains a derived "received" tab (requests
// with at least one received item) alongside the rollup statuses.
export const RECEIVED_TAB = 'received'

/** True when at least one line item has status 'received'. */
export function hasReceivedItem<T extends { line_items?: { status: string }[] | null }>(row: T): boolean {
  return (row.line_items ?? []).some((li) => li.status === 'received')
}

/** Segment-tab filter: 'all' → everything; RECEIVED_TAB → any item received; otherwise exact status match. */
export function filterByTab<T extends { status: string; line_items?: { status: string }[] | null }>(rows: T[], tab: string): T[] {
  if (tab === 'all') return rows
  if (tab === RECEIVED_TAB) return rows.filter(hasReceivedItem)
  return rows.filter((r) => r.status === tab)
}

/** Per-tab counts: rollup statuses + 'all' (via countByStatus) + the derived Received tab. */
export function countByTab<T extends { status: string; line_items?: { status: string }[] | null }>(rows: T[]): Record<string, number> {
  return { ...countByStatus(rows), [RECEIVED_TAB]: rows.filter(hasReceivedItem).length }
}
