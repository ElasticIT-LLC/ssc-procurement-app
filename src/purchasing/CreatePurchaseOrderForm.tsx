import { useState } from 'react'
import { useProcurementApi, Location } from '../data/db'
import { DateInput, todayIso } from '../components/DateInput'

interface Props {
  itemIds: string[]
  requestIds: string[]
  locations: Location[]
  onCancel: () => void
  onCreated: (po: { id: string; po_number: string }) => void | Promise<void>
}

export function CreatePurchaseOrderForm({ itemIds, requestIds, locations, onCancel, onCreated }: Props) {
  const api = useProcurementApi()
  const [vendor, setVendor] = useState('')
  const [datePurchased, setDatePurchased] = useState(todayIso())
  const [eta, setEta] = useState('')
  const [shippingLocationId, setShippingLocationId] = useState('')
  const [customShipping, setCustomShipping] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOther = shippingLocationId === '__other__'

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const po = await api.createPurchaseOrder(itemIds, {
        vendor: vendor || null,
        date_purchased: datePurchased || undefined,
        eta: eta || undefined,
        shipping_location_id: isOther ? null : (shippingLocationId || null),
        custom_shipping_location: isOther ? (customShipping || null) : null,
        notes: notes || null,
      })
      // Reuse the existing ordered notification, fired once for the whole PO
      // (the items were ordered together — one notification, not one per item).
      await api.fireNotification('item_ordered', undefined, itemIds)
      // C2/D5: post the PO notes to each distinct request thread (source 'purchasing').
      // Bulk POs span requests, so one comment per request; body carries the PO number.
      const note = notes.trim()
      if (note && requestIds.length) {
        for (const reqId of requestIds) {
          try {
            const row = await api.postRequestComment({
              request_id: reqId,
              line_item_id: null,
              source: 'purchasing',
              body: `${note} (PO ${po.po_number})`,
            })
            api.fireCommentNotification(row.id)
          } catch (e) {
            console.error('Failed to post PO thread comment:', e)
          }
        }
      }
      await onCreated(po)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4 grid gap-3">
      <p className="text-xs font-semibold text-foreground">New Purchase Order ({itemIds.length} item{itemIds.length === 1 ? '' : 's'})</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Vendor</label>
        <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. CDW" className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Date Purchased</label>
        <DateInput
          value={datePurchased}
          onChange={setDatePurchased}
          className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">ETA</label>
        <DateInput
          value={eta}
          onChange={setEta}
          className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Shipping Location</label>
        <select value={shippingLocationId} onChange={e => setShippingLocationId(e.target.value)} className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
          <option value="">— Select location —</option>
          {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          <option value="__other__">Other</option>
        </select>
      </div>
      {isOther && (
        <div className="grid gap-1">
          <label className="text-xs font-medium text-foreground">Custom Shipping Location</label>
          <input type="text" value={customShipping} onChange={e => setCustomShipping(e.target.value)} placeholder="Enter address or location" className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
      )}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Optional notes…" className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={submit} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{busy ? 'Creating…' : 'Create PO'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Cancel</button>
      </div>
    </div>
  )
}
