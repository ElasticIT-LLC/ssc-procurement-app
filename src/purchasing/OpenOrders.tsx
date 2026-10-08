import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, PurchaseOrderRow, LineItemWithRequest, Location } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { ReplacementBadge } from '../requester/ReplacementBadge'
import { formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'
import { resolveLocationName, locationCounts, effectiveFilterValue } from '../lib/locationLabel'
import { LocationFilter } from '../components/LocationFilter'
import { GlCodeLabel } from '../components/GlCodeLabel'
import { poReceiveProgress } from './orders'
import { Modal } from '../components/Modal'

export function OpenOrders() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [locFilter, setLocFilter] = useState('all')
  const [receiveFor, setReceiveFor] = useState<LineItemWithRequest | null>(null)
  const [receiveNote, setReceiveNote] = useState('')
  const [cancelFor, setCancelFor] = useState<LineItemWithRequest | null>(null)
  const [cancelComment, setCancelComment] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [openPos, locs] = await Promise.all([api.listPurchaseOrders('open'), api.listLocations()])
      setPos(openPos)
      setLocations(locs)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  // z8ygbxr03b (v3.1): location chip filter + alphabetical sorts — POs by
  // number, items within a PO by name; POs with no matching item are hidden.
  const allItems = useMemo(() => pos.flatMap((p) => p.line_items), [pos])
  const locOptions = useMemo(() => locationCounts(allItems, locations), [allItems, locations])
  const activeLoc = effectiveFilterValue(locFilter, locOptions)
  const visiblePos = useMemo(() => {
    const filtered = pos
      .map((po) => ({ ...po, line_items: po.line_items.filter((i) => activeLoc === 'all' || resolveLocationName(i, locations) === activeLoc) }))
      .filter((po) => po.line_items.length > 0)
    return filtered
      .sort((a, b) => a.po_number.localeCompare(b.po_number))
      .map((po) => ({ ...po, line_items: [...po.line_items].sort((x, y) => (x.item_description ?? '').localeCompare(y.item_description ?? '', undefined, { sensitivity: 'base' })) }))
  }, [pos, activeLoc, locations])

  // z8ygbxr03d: mark-received opens a notes dialog; the note (optional) is
  // stored on the line item via receive_line_item(p_notes).
  async function confirmReceive() {
    if (!receiveFor) return
    setBusyId(receiveFor.id)
    try {
      await api.receiveLineItem(receiveFor.id, receiveNote.trim() || null)
      showToast({ message: 'Item marked received', type: 'success' })
      setReceiveFor(null)
      setReceiveNote('')
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to mark received', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }
  // v3.1: cancelling opens a dialog with an optional reason/comment. The
  // comment (when given) is posted to the request's comment thread so the
  // requester sees why the item was cancelled in Request Detail.
  async function confirmCancel() {
    if (!cancelFor) return
    setBusyId(cancelFor.id)
    try {
      await api.cancelLineItem(cancelFor.id)
      await api.notifyStatusUpdate(cancelFor.request.id, [cancelFor.id], 'item_cancelled')
      api.fireNotification('item_cancelled', cancelFor.request.id, [cancelFor.id])
      const comment = cancelComment.trim()
      if (comment) {
        try {
          await api.postRequestComment({ request_id: cancelFor.request.id, line_item_id: cancelFor.id, source: 'purchasing', body: comment })
        } catch (err: unknown) {
          showToast({ message: 'Item cancelled, but the comment could not be saved', type: 'error' })
        }
      }
      showToast({ message: 'Item cancelled', type: 'success' })
      setCancelFor(null)
      setCancelComment('')
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to cancel item', type: 'error' })
    } finally {
      setBusyId(null)
    }
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
  if (pos.length === 0) return <p className="text-sm text-muted-foreground">No open orders.</p>

  return (
    <div className="grid gap-4">
      <LocationFilter options={locOptions} total={allItems.length} value={activeLoc} onChange={setLocFilter} />
      {visiblePos.length === 0 && (
        <p className="text-sm text-muted-foreground">No orders match this location.</p>
      )}
      {visiblePos.map(po => {
        const prog = poReceiveProgress(po.line_items)
        return (
          <div key={po.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">{po.po_number}{po.vendor ? ` · ${po.vendor}` : ''}</p>
                <p className="text-xs text-muted-foreground">{prog.received} of {prog.total} received{po.eta ? ` · Order ETA ${formatDate(po.eta)}` : ''}</p>
              </div>
              <button type="button" disabled={busyId === po.id} onClick={() => closePo(po.id)} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">Close PO</button>
            </div>
            <div className="grid gap-2">
              {po.line_items.map(item => {
                const locText = resolveLocationName(item, locations)
                return (
                  <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                      <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                      {locText && <p className="text-xs text-muted-foreground">Location: {locText}</p>}
                <GlCodeLabel glCode={item.gl_code} />
                      {item.ship_to_name && <p className="text-xs text-muted-foreground">Ship to: {item.ship_to_name}</p>}
                      {item.receive_notes && <p className="text-xs text-muted-foreground">Notes: {item.receive_notes}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <ReplacementBadge item={item} />
                      <StatusBadge status={item.status} />
                      {item.status === 'ordered' && (
                        <>
                          <button type="button" disabled={busyId === item.id} onClick={() => { setReceiveFor(item); setReceiveNote('') }} className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Mark Received</button>
                          <button type="button" disabled={busyId === item.id} onClick={() => { setCancelFor(item); setCancelComment('') }} className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50">Cancel Order</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {receiveFor && (
        <Modal title={`Mark Received — ${receiveFor.item_description || 'item'}`} onClose={() => { if (busyId !== receiveFor.id) setReceiveFor(null) }}>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{formatItemRef(receiveFor.request?.request_number, receiveFor.line_no)} — Qty {receiveFor.quantity}</p>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Notes (optional)</label>
              <textarea
                rows={3}
                value={receiveNote}
                onChange={(e) => setReceiveNote(e.target.value)}
                placeholder="e.g. delivery details, condition on arrival…"
                className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" disabled={busyId === receiveFor.id} onClick={() => setReceiveFor(null)} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">Cancel</button>
              <button type="button" disabled={busyId === receiveFor.id} onClick={() => { void confirmReceive() }} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Confirm Received</button>
            </div>
          </div>
        </Modal>
      )}

      {cancelFor && (
        <Modal title={`Cancel Order — ${cancelFor.item_description || 'item'}`} onClose={() => { if (busyId !== cancelFor.id) setCancelFor(null) }}>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{formatItemRef(cancelFor.request?.request_number, cancelFor.line_no)} — Qty {cancelFor.quantity}. Cancelling marks the item cancelled and the requester will need to submit a new request if still needed.</p>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Reason / comment (optional)</label>
              <textarea
                rows={3}
                value={cancelComment}
                onChange={(e) => setCancelComment(e.target.value)}
                placeholder="e.g. duplicate order, supplier out of stock…"
                className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" disabled={busyId === cancelFor.id} onClick={() => setCancelFor(null)} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">Cancel</button>
              <button type="button" disabled={busyId === cancelFor.id} onClick={() => { void confirmCancel() }} className="inline-flex items-center rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50">Confirm Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
