import { useState, useEffect } from 'react'
import { usePermissions } from '@elasticit-llc/app-bridge'
import { useProcurementApi, RequestRow } from '../data/db'
import { PERMS } from '../lib/constants'
import { StatusBadge } from './StatusBadge'

interface RequestsListProps {
  onNew: () => void
  onSelect: (id: string) => void
}

export function RequestsList({ onNew, onSelect }: RequestsListProps) {
  const api = useProcurementApi()
  const { hasPermission } = usePermissions()

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.listRequests()
      .then((rows) => setRequests(rows))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load requests'))
      .finally(() => setLoading(false))
  }, [])

  const canCreate = hasPermission(PERMS.create)

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">My Requests</h2>
        {canCreate && (
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            + New Request
          </button>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          You have no requests yet.{canCreate ? ' Click "New Request" to get started.' : ''}
        </div>
      ) : (
        <div className="grid gap-2">
          {requests.map((req) => (
            <button
              key={req.id}
              type="button"
              onClick={() => onSelect(req.id)}
              className="w-full text-left rounded-lg border border-border bg-card p-4 hover:bg-muted transition-colors grid gap-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {req.notes ? (req.notes.length > 80 ? req.notes.slice(0, 80) + '…' : req.notes) : 'No notes'}
                </span>
                <StatusBadge status={req.status} />
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Submitted: {new Date(req.submitted_at).toLocaleDateString()}</span>
                <span>Updated: {new Date(req.updated_at).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
