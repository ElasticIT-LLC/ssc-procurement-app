import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, PurchaseOrderRow, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'
import { poReceiveProgress } from './orders'

export function OpenOrders() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [loose, setLoose] = useState<LineItemWithRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [openPos, ordered] = await Promise.all([
        api.listPurchaseOrders('open'),
        api.listLineItemsByStatus(['ordered', 'replacement_ordered']),
      ])
      setPos(openPos)
      setLoose(ordered.filter(i => !i.po_id)) // standalone per-item orders (no PO)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function receive(id: string) {
    setBusyId(id)
    try { await api.receiveLineItem(id); showToast({ message: 'Item marked received', type: 'success' }); await load() }
    catch (err: unknown) { showToast({ message: err instanceof Error ? err.message : 'Failed to mark received', type: 'error' }) }
    finally { setBusyId(null) }
  }
  async function closePo(id: string) {
    if (!window.confirm('Close this purchase order? Remaining items will stay in their current state.')) return
    setBusyId(id)
    try { await api.closePurchaseOrder(id); showToast({ message: 'Purchase order closed', type: 'success' }); await load() }
    catch (err: unknown) { showToast({ message: err instanceof Error ? err.message : 'Failed to close PO', type: 'error' }) }
    finally { setBusyId(null) }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  if (error) return <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
  if (pos.length === 0 && loose.length === 0) return <p className="text-sm text-muted-foreground">No open orders.</p>

  return (
    <div className="grid gap-4">
      {pos.map(po => {
        const prog = poReceiveProgress(po.line_items)
        return (
          <div key={po.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">{po.po_number}{po.vendor ? ` · ${po.vendor}` : ''}</p>
                <p className="text-xs text-muted-foreground">{prog.received} of {prog.total} received{po.eta ? ` · ETA ${formatDate(po.eta)}` : ''}</p>
              </div>
              <button type="button" disabled={busyId === po.id} onClick={() => closePo(po.id)} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">Close PO</button>
            </div>
            <div className="grid gap-2">
              {po.line_items.map(item => (
                <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                    <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.status} />
                    {item.status === 'ordered' && (
                      <button type="button" disabled={busyId === item.id} onClick={() => receive(item.id)} className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Mark Received</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {loose.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-foreground">Individual Orders (no PO)</h3>
          {loose.map(item => (
            <div key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                <p className="text-xs text-muted-foreground">Qty: {item.quantity}{item.eta ? ` · ETA ${formatDate(item.eta)}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={item.status} />
                {item.status === 'ordered' && (
                  <button type="button" disabled={busyId === item.id} onClick={() => receive(item.id)} className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Mark Received</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
