import { useState, useEffect, useCallback } from 'react'
import { useToast, usePermissions } from '@elasticit-llc/app-bridge'
import { useProcurementApi, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { PERMS } from '../lib/constants'

function humanizeReason(reason: string): string {
  if (!reason) return ''
  const label = reason.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function ReturnsPage() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasPermission } = usePermissions()

  const [items, setItems] = useState<LineItemWithRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listLineItemsByStatus(['returned'])
      setItems(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleProcess(item: LineItemWithRequest) {
    setBusyId(item.id)
    try {
      await api.processReturn(item.id, item.wants_replacement ?? false)
      showToast({ message: 'Return processed', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to process return', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  if (!hasPermission(PERMS.returns)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Returns</h1>
        <p className="text-muted-foreground text-sm">Process items awaiting return handling.</p>
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
        <p className="text-sm text-muted-foreground">No items awaiting return processing.</p>
      )}

      {!loading && !error && items.map(item => (
        <div key={item.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">
                {item.item_description ?? 'Unnamed item'}
              </p>
              <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
            </div>
            <StatusBadge status={item.status} />
          </div>

          {/* Return details */}
          <div className="rounded-md border border-border bg-muted/40 p-3 grid gap-1">
            <p className="text-xs font-medium text-foreground">Return Details</p>
            {item.return_reason && (
              <p className="text-xs text-muted-foreground">
                Reason: {humanizeReason(item.return_reason)}
              </p>
            )}
            {item.return_quantity != null && (
              <p className="text-xs text-muted-foreground">Return qty: {item.return_quantity}</p>
            )}
            {item.wants_replacement && (
              <span className="inline-flex self-start items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-info/15 text-info">
                Wants replacement
              </span>
            )}
            {item.return_notes && (
              <p className="text-xs text-muted-foreground">Notes: {item.return_notes}</p>
            )}
          </div>

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
              Submitted: {new Date(item.request.submitted_at).toLocaleDateString()}
            </p>
          </div>

          {/* Action */}
          <button
            type="button"
            disabled={busyId === item.id}
            onClick={() => handleProcess(item)}
            className="self-start inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busyId === item.id ? 'Processing…' : 'Process Return'}
          </button>
        </div>
      ))}
    </div>
  )
}

export default ReturnsPage
