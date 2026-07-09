import { useState, useEffect, useCallback } from 'react'
import { useProcurementApi, PurchaseOrderRow } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'

export function ClosedOrders() {
  const api = useProcurementApi()
  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setPos(await api.listPurchaseOrders('closed')) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed to load closed orders') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  if (error) return <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
  if (pos.length === 0) return <p className="text-sm text-muted-foreground">No closed orders.</p>

  return (
    <div className="grid gap-4">
      {pos.map(po => (
        <div key={po.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{po.po_number}{po.vendor ? ` · ${po.vendor}` : ''}</p>
            <p className="text-xs text-muted-foreground">Closed {po.closed_at ? formatDate(po.closed_at) : ''} · {po.line_items.length} item{po.line_items.length === 1 ? '' : 's'}</p>
          </div>
          <div className="grid gap-2">
            {po.line_items.map(item => (
              <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
                <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
