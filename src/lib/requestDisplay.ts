// Derived display status for request cards/headers. The server rollup
// (proc_recompute_request_status) never produces 'received' — it lumps
// received items into the approved bucket. We derive it for display:
// when every line item is terminal-received (or declined/cancelled) and at
// least one is received, the request reads as Received.
export function displayRequestStatus(req: { status: string; line_items?: { status: string }[] | null }): string {
  const statuses = (req.line_items ?? []).map((li) => li.status)
  if (
    statuses.length > 0
    && statuses.some((s) => s === 'received')
    && statuses.every((s) => s === 'received' || s === 'declined' || s === 'cancelled')
  ) {
    return 'received'
  }
  return req.status
}
