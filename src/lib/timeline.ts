import type { LineItemRow, RequestCommentRow, RequestRow } from '../data/db'

export type TimelineKind = 'submitted' | 'comment' | 'decision' | 'ordered' | 'received' | 'returned' | 'return_processed' | 'cancelled' | 'archived'

export interface TimelineEvent {
  id: string
  at: string | null
  kind: TimelineKind
  label: string
  detail?: string
  badge?: string
}

const DECISION_LABEL: Record<string, string> = { approved: 'approved', declined: 'declined', on_hold: 'placed on hold' }

interface TimelineInput {
  request: Pick<RequestRow, 'request_number' | 'submitted_at' | 'status'>
  items: LineItemRow[]
  comments: RequestCommentRow[]
  itemName: (li: LineItemRow) => string
  nameOf: (id: string) => string
}

// Derived timeline (decision 14: no event log table). Newest first.
// "received" and "cancelled" use their dedicated stamps (received_at/cancelled_at,
// added in Wave B) when present, falling back to line_items.updated_at for legacy
// rows stamped before those columns existed (spec Risk 3).
export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const { request, items, comments, itemName, nameOf } = input
  const events: TimelineEvent[] = [
    { id: 'submitted', at: request.submitted_at, kind: 'submitted', label: `Request submitted${request.request_number != null ? ` #${request.request_number}` : ''}` },
  ]

  for (const li of items) {
    const name = itemName(li)
    if (DECISION_LABEL[li.status] && li.approval_date && li.approved_by) {
      events.push({ id: `li-${li.id}-decision`, at: li.approval_date, kind: 'decision', badge: li.status, label: `${nameOf(li.approved_by)} ${DECISION_LABEL[li.status]} ${name}` })
    }
    if (['ordered', 'received', 'returned', 'replacement_ordered'].includes(li.status) && li.date_purchased) {
      events.push({ id: `li-${li.id}-ordered`, at: `${li.date_purchased}T12:00:00Z`, kind: 'ordered', label: `Ordered ${name}${li.po_id ? ' (PO created)' : ''}` })
    }
    if (li.status === 'received') {
      events.push({ id: `li-${li.id}-received`, at: li.received_at ?? li.updated_at, kind: 'received', label: `Marked received — ${name}` })
    }
    if (li.return_date) {
      events.push({ id: `li-${li.id}-returned`, at: li.return_date, kind: 'returned', label: `Return initiated — ${name}` })
    }
    if (li.return_processed_at) {
      events.push({ id: `li-${li.id}-return_processed`, at: li.return_processed_at, kind: 'return_processed', label: `Return processed — ${name}` })
    }
    if (li.status === 'cancelled') {
      events.push({ id: `li-${li.id}-cancelled`, at: li.cancelled_at ?? li.updated_at, kind: 'cancelled', label: `Item cancelled — ${name}` })
    }
    if (li.archived_at) {
      events.push({ id: `li-${li.id}-archived`, at: li.archived_at, kind: 'archived', label: `Item archived — ${name}` })
    }
  }

  for (const c of comments) {
    events.push({
      id: `comment-${c.id}`,
      at: c.created_at,
      kind: 'comment',
      badge: c.source,
      label: `${c.author_name} commented${c.line_item_id ? ' on an item' : ''}`,
      detail: c.body,
    })
  }

  return events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}
