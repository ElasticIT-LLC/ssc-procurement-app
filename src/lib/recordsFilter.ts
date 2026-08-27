import type { LineItemDetailed } from '../data/db'

export function recordSearchText(item: LineItemDetailed): string {
  return [
    item.item_description ?? '',
    item.item_url ?? '',
    item.request.requester_name ?? '',
    item.request.requester_email ?? '',
    item.request.request_number != null ? `req-${item.request.request_number}` : '',
    item.po?.po_number ?? '',
    item.status ?? '',
    item.location?.name ?? item.custom_location ?? '',
    item.department?.name ?? item.custom_department ?? '',
  ].join(' ').toLowerCase()
}

export function filterRecords(rows: LineItemDetailed[], keyword: string): LineItemDetailed[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) => recordSearchText(row).includes(q))
}
