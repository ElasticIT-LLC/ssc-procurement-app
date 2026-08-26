import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, LineItemWithRequest, Location } from '../data/db'
import { DateInput, todayIso } from '../components/DateInput'
import { StatusBadge } from '../requester/StatusBadge'
import { ReplacementBadge } from '../requester/ReplacementBadge'
import { formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'
import { CreatePurchaseOrderForm } from './CreatePurchaseOrderForm'

interface OrderForm {
  date_purchased: string
  eta: string
  shipping_location_id: string
  custom_shipping_location: string
  purchase_notes: string
}

function emptyForm(): OrderForm {
  return { date_purchased: todayIso(), eta: '', shipping_location_id: '', custom_shipping_location: '', purchase_notes: '' }
}

export function ReadyForPurchasing() {
  const api = useProcurementApi()
  const { showToast } = useToast()

  const [items, setItems] = useState<LineItemWithRequest[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openFormId, setOpenFormId] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, OrderForm>>({})
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showPoForm, setShowPoForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, locs] = await Promise.all([
        api.listLineItemsByStatus(['approved']),
        api.listLocations(),
      ])
      setItems(data)
      setLocations(locs)
      // Drop any selected ids that are no longer approved (item was individually
      // ordered/cancelled, moved onto a PO, or changed elsewhere) so the toolbar
      // count and a subsequent Create-PO never reference stale items.
      setSelected(prev => new Set([...prev].filter(id => data.some(i => i.id === id))))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggleForm(itemId: string) {
    if (openFormId === itemId) {
      setOpenFormId(null)
    } else {
      setForms(prev => ({ ...prev, [itemId]: prev[itemId] ?? emptyForm() }))
      setOpenFormId(itemId)
    }
  }

  function updateForm(itemId: string, patch: Partial<OrderForm>) {
    setForms(prev => ({ ...prev, [itemId]: { ...(prev[itemId] ?? emptyForm()), ...patch } }))
  }

  async function handleSubmit(item: LineItemWithRequest) {
    const form = forms[item.id] ?? emptyForm()
    setSubmittingId(item.id)
    try {
      const isOther = form.shipping_location_id === '__other__'
      await api.orderLineItem(item.id, {
        date_purchased: form.date_purchased || undefined,
        eta: form.eta || undefined,
        shipping_location_id: isOther ? null : (form.shipping_location_id || null),
        custom_shipping_location: isOther ? (form.custom_shipping_location || null) : null,
        purchase_notes: form.purchase_notes || null,
      })
      await api.notifyStatusUpdate(item.request.id, [item.id], 'item_ordered')
      api.fireNotification('item_ordered', item.request.id, [item.id])
      showToast({ message: 'Order recorded', type: 'success' })
      setOpenFormId(null)
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to record order', type: 'error' })
    } finally {
      setSubmittingId(null)
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  return (
    <div className="grid gap-6">
      {loading && (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
      )}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No approved items to order.</p>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2">
          <span className="text-sm text-foreground">{selected.size} selected</span>
          <button type="button" onClick={() => setShowPoForm(true)} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">Create Purchase Order</button>
        </div>
      )}
      {showPoForm && (
        <CreatePurchaseOrderForm
          itemIds={[...selected]}
          locations={locations}
          onCancel={() => setShowPoForm(false)}
          onCreated={async (po) => { setShowPoForm(false); setSelected(new Set()); showToast({ message: `Created ${po.po_number}`, type: 'success' }); await load() }}
        />
      )}

      {!loading && !error && items.map(item => {
        const form = forms[item.id] ?? emptyForm()
        const isOpen = openFormId === item.id
        const isOther = form.shipping_location_id === '__other__'
        const busy = submittingId === item.id

        return (
          <div key={item.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}
                  <ReplacementBadge item={item} className="ml-2" />
                </p>
                <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
              </div>
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="mt-1 h-4 w-4 accent-primary" aria-label="Select for purchase order" />
                <StatusBadge status={item.status} />
              </div>
            </div>

            {item.item_url && (
              <a
                href={item.item_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline break-all"
              >
                {item.item_url}
              </a>
            )}

            {item.memo && (
              <p className="text-xs text-muted-foreground">Memo: {item.memo}</p>
            )}

            {item.date_needed && (
              <p className="text-xs text-muted-foreground">
                Date needed: {formatDate(item.date_needed)}
              </p>
            )}

            {/* Requester context */}
            <div className="rounded-md border border-border bg-muted/40 p-3 grid gap-1">
              <p className="text-xs font-medium text-foreground">Requester</p>
              {item.request.requester_name && (
                <p className="text-xs text-muted-foreground">{item.request.requester_name}</p>
              )}
              {item.request.requester_email && (
                <p className="text-xs text-muted-foreground">{item.request.requester_email}</p>
              )}
              {item.request.notes && (
                <p className="text-xs text-muted-foreground">Notes: {item.request.notes}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Submitted: {formatDate(item.request.submitted_at)}
              </p>
            </div>

            {/* Place Order action */}
            {!isOpen && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleForm(item.id)}
                  className="self-start inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  Place Order
                </button>
              </div>
            )}

            {/* Inline order form */}
            {isOpen && (
              <div className="rounded-md border border-border bg-muted/20 p-4 grid gap-3">
                <p className="text-xs font-semibold text-foreground">Order Details</p>

                <div className="grid gap-1">
                  <label className="text-xs font-medium text-foreground">Date Purchased</label>
                  <DateInput
                    value={form.date_purchased}
                    onChange={(v) => updateForm(item.id, { date_purchased: v })}
                    className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="grid gap-1">
                  <label className="text-xs font-medium text-foreground">ETA</label>
                  <DateInput
                    value={form.eta}
                    onChange={(v) => updateForm(item.id, { eta: v })}
                    className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="grid gap-1">
                  <label className="text-xs font-medium text-foreground">Shipping Location</label>
                  <select
                    value={form.shipping_location_id}
                    onChange={e => updateForm(item.id, { shipping_location_id: e.target.value })}
                    className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">— Select location —</option>
                    {locations.map(loc => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                    <option value="__other__">Other</option>
                  </select>
                </div>

                {isOther && (
                  <div className="grid gap-1">
                    <label className="text-xs font-medium text-foreground">Custom Shipping Location</label>
                    <input
                      type="text"
                      value={form.custom_shipping_location}
                      onChange={e => updateForm(item.id, { custom_shipping_location: e.target.value })}
                      placeholder="Enter address or location"
                      className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}

                <div className="grid gap-1">
                  <label className="text-xs font-medium text-foreground">Purchase Notes</label>
                  <textarea
                    value={form.purchase_notes}
                    onChange={e => updateForm(item.id, { purchase_notes: e.target.value })}
                    rows={3}
                    placeholder="Optional notes…"
                    className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleSubmit(item)}
                    className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Submit Order'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOpenFormId(null)}
                    className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
