/** Human-readable request number, e.g. #123. Falls back to #— when unassigned. */
export function formatRequestNo(n: number | null | undefined): string {
  return n == null ? '#—' : `#${n}`
}

/** Per-item reference, e.g. #123-2. Drops the line suffix when unknown. */
export function formatItemRef(
  requestNo: number | null | undefined,
  lineNo: number | null | undefined,
): string {
  if (requestNo == null) return '#—'
  return lineNo == null ? `#${requestNo}` : `#${requestNo}-${lineNo}`
}
