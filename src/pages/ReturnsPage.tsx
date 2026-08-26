import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useProcurementApi, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { PERMS, formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'

function humanizeReason(reason: string): string {
  if (!reason) return ''
  const label = reason.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function ReturnCard({
  item,
  busy,
  onProcess,
}: {
  item: LineItemWithRequest
  busy: boolean
  onProcess?: (item: LineItemWithRequest) => void
}) {
  const processed = item.return_processed_at != null
  const wantsReplacement = item.wants_replacement ?? false

  return (
    <div className="rounded-lg border border-border bg-card p-4 grid gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">
            {formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}
          </p>
          <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
        </div>
        <div className="flex items-center gap-2">
          {processed && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Processed
            </span>
          )}
          {wantsReplacement && !processed && (
            <span className="inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 text-xs font-medium text-info">
              Replacement
            </span>
          )}
          <StatusBadge status={item.status} />
        </div>
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
        {item.return_notes && (
          <p className="text-xs text-muted-foreground">Notes: {item.return_notes}</p>
        )}
        {processed && item.return_processed_at && (
          <p className="text-xs text-muted-foreground">Processed: {formatDate(item.return_processed_at)}</p>
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
          Submitted: {formatDate(item.request.submitted_at)}
        </p>
      </div>

      {/* Action */}
      {onProcess && !processed && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onProcess(item)}
          className="self-start inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Processing…' : 'Process Return'}
        </button>
      )}
    </div>
  )
}

export function ReturnsPage() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()

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

  if (!hasAppPermission(PERMS.returns)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  const pending = items.filter((i) => i.return_processed_at == null)
  const processed = items.filter((i) => i.return_processed_at != null)

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Returns</h1>
        <p className="text-muted-foreground text-sm">Process and review returned items.</p>
      </div>

      {loading && (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
      )}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Pending returns */}
          <div className="grid gap-4">
            <h2 className="text-sm font-semibold text-foreground">Pending Returns ({pending.length})</h2>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items awaiting return processing.</p>
            ) : (
              <div className="grid gap-3">
                {pending.map((item) => (
                  <ReturnCard
                    key={item.id}
                    item={item}
                    busy={busyId === item.id}
                    onProcess={handleProcess}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Processed returns */}
          <div className="grid gap-4">
            <h2 className="text-sm font-semibold text-foreground">Processed Returns ({processed.length})</h2>
            {processed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No processed returns yet.</p>
            ) : (
              <div className="grid gap-3">
                {processed.map((item) => (
                  <ReturnCard key={item.id} item={item} busy={false} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ReturnsPage
