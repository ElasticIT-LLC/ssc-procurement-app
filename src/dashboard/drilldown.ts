import type { LineItemDetailed, RequestRow } from '../data/db'

/** Requests currently in the given status. */
export function filterRequestsByStatus(requests: RequestRow[], status: string): RequestRow[] {
  return requests.filter(r => r.status === status)
}

/** Requests submitted in the given UTC month bucket ('YYYY-MM'), matching `requestsByMonth` bucketing. */
export function filterRequestsByMonth(requests: RequestRow[], month: string): RequestRow[] {
  return requests.filter(r => r.submitted_at.slice(0, 7) === month)
}

/** Line items whose status is in the given set. */
export function filterItemsByStatus(items: LineItemDetailed[], statuses: string[]): LineItemDetailed[] {
  const set = new Set(statuses)
  return items.filter(i => set.has(i.status))
}

/**
 * Line items at the given location, using the same bucketing as `itemsByLocation`
 * in stats.ts: named locations match by resolved name; 'Other' matches items
 * with no location or an unresolvable location_id.
 */
export function filterItemsByLocation(
  items: LineItemDetailed[],
  locationNames: Record<string, string>,
  location: string,
): LineItemDetailed[] {
  if (location === 'Other') {
    return items.filter(i => !(i.location_id ? locationNames[i.location_id] : undefined))
  }
  return items.filter(i => {
    const id = i.location_id
    return id !== null && locationNames[id] === location
  })
}

/**
 * Pending requests owned by the given user. Staff roles see ALL requests in
 * their list, so ownership must be applied explicitly: by requester_id for
 * in-portal submissions, or by requester_email for public-form (anonymous)
 * submissions.
 */
export function myPendingRequests(
  requests: RequestRow[],
  userId: string | null | undefined,
  userEmail: string | null | undefined,
): RequestRow[] {
  return requests.filter(r => {
    if (r.status !== 'pending') return false
    if (userId && r.requester_id === userId) return true
    if (!r.requester_id && userEmail && r.requester_email === userEmail) return true
    return false
  })
}
