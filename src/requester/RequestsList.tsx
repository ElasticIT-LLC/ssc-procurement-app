import { useState, useEffect } from 'react'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useSupabase } from '@elasticit-llc/app-bridge'
import { useProcurementApi, RequestRow } from '../data/db'
import { PERMS, formatDate, REQUEST_STATUS } from '../lib/constants'
import { formatRequestNo } from '../lib/itemRef'
import { countByStatus, filterByStatus } from '../lib/requestFilter'
import { StatusBadge } from './StatusBadge'
import { useFormattingRules } from '../formatting/useFormattingRules'

interface RequestsListProps {
  onNew: () => void
  onSelect: (id: string) => void
}

export function RequestsList({ onNew, onSelect }: RequestsListProps) {
  const api = useProcurementApi()
  const { hasAppPermission } = useAppPermissions()
  const supabase = useSupabase()
  const { toneClassFor } = useFormattingRules()

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<string>('all')
  const counts = countByStatus(requests)
  const visible = filterByStatus(requests, tab)
  const TABS = ['all', ...REQUEST_STATUS] as const

  useEffect(() => {
    setLoading(true)
    const load = async () => {
      const { data, error: authErr } = await supabase.auth.getUser()
      if (authErr || !data.user) throw new Error('Unable to identify current user')
      return api.listRequests(data.user.id, data.user.email)
    }
    load()
      .then((rows) => setRequests(rows))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load requests'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canCreate = hasAppPermission(PERMS.create)

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

      <div className="flex overflow-x-auto gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium capitalize border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.replace(/_/g, ' ')} {counts[t] ? `(${counts[t]})` : '(0)'}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          No requests in this view.
        </div>
      ) : (
        <div className="grid gap-2">
          {visible.map((req) => (
            <button
              key={req.id}
              type="button"
              onClick={() => onSelect(req.id)}
              className={`w-full text-left rounded-lg border border-border bg-card p-4 hover:bg-muted transition-colors grid gap-1 ${toneClassFor(req as unknown as Record<string, unknown>)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {formatRequestNo(req.request_number)}
                  {' · '}
                  {(() => {
                    const items = req.line_items ?? []
                    const first = items[0]?.item_description?.trim()
                    if (!first) return req.notes?.trim() || 'Untitled request'
                    return items.length > 1 ? `${first} (+${items.length - 1} more)` : first
                  })()}
                </span>
                <StatusBadge status={req.status} />
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Submitted: {formatDate(req.submitted_at)}</span>
                <span>Updated: {formatDate(req.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
