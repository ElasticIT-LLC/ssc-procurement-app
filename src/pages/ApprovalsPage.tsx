import { useState, useEffect, useCallback } from 'react'
import { useToast, usePermissions } from '@elasticit-llc/app-bridge'
import { useProcurementApi, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { PERMS, formatDate } from '../lib/constants'

export function ApprovalsPage() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasPermission } = usePermissions()

  const [items, setItems] = useState<LineItemWithRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listLineItemsByStatus(['pending', 'on_hold'])
      setItems(data)
      const urls: Record<string, string> = {}
      await Promise.all(data.filter((i) => i.product_image_path).map(async (i) => { const u = await api.getProductImageUrl(i.product_image_path as string); if (u) urls[i.id] = u }))
      setImageUrls(urls)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(id: string, action: 'approved' | 'declined' | 'on_hold') {
    const reqId = items.find((it) => it.id === id)?.request.id
    setBusyId(id)
    try {
      await api.decideLineItem(id, action)
      const messages: Record<typeof action, string> = {
        approved: 'Item approved',
        declined: 'Item declined',
        on_hold: 'Item placed on hold',
      }
      showToast({ message: messages[action], type: 'success' })
      if (action === 'approved') await api.fireNotification('item_approved')
      else if (action === 'declined') await api.fireNotification('item_declined')
      const remaining = await api.listLineItemsByStatus(['pending', 'on_hold'])
      setItems(remaining)
      if (reqId && !remaining.some((it) => it.request.id === reqId)) api.notifyApproved(reqId)
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Action failed', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  if (!hasPermission(PERMS.approve)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Approvals</h1>
        <p className="text-muted-foreground text-sm">Review pending and on-hold items.</p>
      </div>

      {loading && (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
      )}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No items pending approval.</p>
      )}

      {!loading && !error && items.map(item => (
        <div key={item.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
          {/* Header: description + status */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">
                {item.item_description ?? 'Unnamed item'}
              </p>
              <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
            </div>
            <StatusBadge status={item.status} />
          </div>

          {/* Product image or retry capture */}
          {imageUrls[item.id] ? (
            <img src={imageUrls[item.id]} alt="Product" className="max-w-[240px] rounded-md border border-border" />
          ) : item.item_url ? (
            <button type="button" disabled={busyId === item.id} onClick={async () => { setBusyId(item.id); try { await api.captureAndNotify(item.request.id, item.id); await load() } finally { setBusyId(null) } }} className="self-start inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">
              Product image unavailable — Retry capture
            </button>
          ) : null}

          {/* Item URL */}
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

          {/* Memo */}
          {item.memo && (
            <p className="text-xs text-muted-foreground">Memo: {item.memo}</p>
          )}

          {/* Date needed */}
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handleAction(item.id, 'approved')}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handleAction(item.id, 'declined')}
              className="inline-flex items-center rounded-md bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
            >
              Decline
            </button>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handleAction(item.id, 'on_hold')}
              className="inline-flex items-center rounded-md bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/25 disabled:opacity-50"
            >
              Hold
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default ApprovalsPage
