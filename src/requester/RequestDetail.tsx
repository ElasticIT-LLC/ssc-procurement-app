import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, RequestRow, LineItemRow } from '../data/db'
import { StatusBadge } from './StatusBadge'
import { ReturnForm } from './ReturnForm'
import { formatDate } from '../lib/constants'

interface RequestDetailProps {
  requestId: string
  onBack: () => void
}

export function RequestDetail({ requestId, onBack }: RequestDetailProps) {
  const api = useProcurementApi()
  const { showToast } = useToast()

  const [request, setRequest] = useState<RequestRow | null>(null)
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [returnOpenId, setReturnOpenId] = useState<string | null>(null)
  const [receivingId, setReceivingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [req, items] = await Promise.all([
        api.getRequest(requestId),
        api.listLineItems(requestId),
      ])
      setRequest(req)
      setLineItems(items)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load request')
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => { load() }, [load])

  async function handleReceive(itemId: string) {
    setReceivingId(itemId)
    try {
      await api.receiveLineItem(itemId)
      showToast({ message: 'Item marked as received', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to mark received', type: 'error' })
    } finally {
      setReceivingId(null)
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  }

  if (error || !request) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        {error ?? 'Request not found'}
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 grid gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Request</h2>
          <StatusBadge status={request.status} />
        </div>
        {request.notes && (
          <p className="text-sm text-foreground">{request.notes}</p>
        )}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>Submitted: {formatDate(request.submitted_at)}</span>
          <span>Updated: {formatDate(request.updated_at)}</span>
          {request.requester_name && <span>By: {request.requester_name}</span>}
        </div>
      </div>

      {/* Line items */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold text-foreground">Items ({lineItems.length})</h3>
        {lineItems.length === 0 && (
          <p className="text-sm text-muted-foreground">No items found.</p>
        )}
        {lineItems.map((item, idx) => (
          <div key={item.id} className="rounded-lg border border-border bg-card p-4 grid gap-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Item #{idx + 1}{item.item_description ? ` — ${item.item_description}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
              </div>
              <StatusBadge status={item.status} />
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

            {/* Owner actions */}
            {item.status === 'ordered' && (
              <button
                type="button"
                onClick={() => handleReceive(item.id)}
                disabled={receivingId === item.id}
                className="mt-1 self-start inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {receivingId === item.id ? 'Marking…' : 'Mark Received'}
              </button>
            )}

            {item.status === 'received' && returnOpenId !== item.id && (
              <button
                type="button"
                onClick={() => setReturnOpenId(item.id)}
                className="mt-1 self-start inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                Initiate Return
              </button>
            )}

            {item.status === 'received' && returnOpenId === item.id && (
              <ReturnForm
                item={item}
                onDone={async () => {
                  setReturnOpenId(null)
                  await load()
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
