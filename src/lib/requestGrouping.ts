import type { RequestLineItem, RequestRow } from '../data/db'

export interface ItemRowView {
  request: RequestRow
  item: RequestLineItem
  key: string
  lineIndex: number
}

// Flattens the request list into one row per line item (v4 z8ygbxrhcp, the
// "By item" group mode on the Requests page). Request order is preserved as
// given; within a request, item order is the array order (the listRequests
// projection sorts line items by line_no). Requests without line items
// produce no rows. Each row keeps its request reference so the status pill,
// requester, and dates stay one property away.
export function flattenToItemRows(requests: RequestRow[]): ItemRowView[] {
  const rows: ItemRowView[] = []
  for (const request of requests) {
    const items = request.line_items ?? []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item === undefined) continue
      rows.push({ request, item, key: `${request.id}:${i}`, lineIndex: i })
    }
  }
  return rows
}
