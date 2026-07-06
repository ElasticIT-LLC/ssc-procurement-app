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
