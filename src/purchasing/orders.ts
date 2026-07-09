export interface PoProgress { received: number; total: number }

/** Count how many of a PO's line items have been received, out of the total. */
export function poReceiveProgress(items: { status: string }[]): PoProgress {
  const total = items.length
  const received = items.filter(i => i.status === 'received').length
  return { received, total }
}
