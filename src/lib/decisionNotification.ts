// Map an approvals decision to the shell notification key fired for it.
// Regression guard: on_hold must map to item_on_hold, never item_declined
// (0.26.x bug — a Hold sent the requester an "Item declined" email).
export function decisionNotificationKey(
  action: 'approved' | 'declined' | 'on_hold',
): string {
  if (action === 'approved') return 'item_approved'
  if (action === 'on_hold') return 'item_on_hold'
  return 'item_declined'
}
