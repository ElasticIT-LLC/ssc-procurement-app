import { useState, useEffect, useCallback } from 'react'
import { useShellContext } from '@elasticit-llc/app-bridge'
import { usePermissions } from '@elasticit-llc/app-bridge'
import { useProcurementApi, RequestRow, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { PERMS, formatDate } from '../lib/constants'

interface KpiCardProps {
  label: string
  value: number
  sub: string
}

function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

export function DashboardPage() {
  const { user } = useShellContext()
  const { hasPermission } = usePermissions()
  const api = useProcurementApi()

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [approvalItems, setApprovalItems] = useState<LineItemWithRequest[]>([])
  const [purchaseItems, setPurchaseItems] = useState<LineItemWithRequest[]>([])
  const [returnItems, setReturnItems] = useState<LineItemWithRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canApprove = hasPermission(PERMS.approve)
  const canPurchase = hasPermission(PERMS.purchase)
  const canReturns = hasPermission(PERMS.returns)
  const canCreate = hasPermission(PERMS.create)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const fetches: Promise<unknown>[] = [api.listRequests()]
      if (canApprove) fetches.push(api.listLineItemsByStatus(['pending', 'on_hold']))
      if (canPurchase) fetches.push(api.listLineItemsByStatus(['approved']))
      if (canReturns) fetches.push(api.listLineItemsByStatus(['returned']))

      const [reqs, ...rest] = await Promise.all(fetches)
      setRequests(reqs as RequestRow[])

      let idx = 0
      if (canApprove) { setApprovalItems(rest[idx] as LineItemWithRequest[]); idx++ }
      if (canPurchase) { setPurchaseItems(rest[idx] as LineItemWithRequest[]); idx++ }
      if (canReturns) { setReturnItems(rest[idx] as LineItemWithRequest[]); idx++ }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [canApprove, canPurchase, canReturns])

  useEffect(() => { load() }, [load])

  const myPendingRequests = requests.filter(r => r.status === 'pending').length
  const recentItems = requests.slice(0, 5)

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Welcome back{user?.name ? `, ${user.name}` : ''}.
        </p>
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
          {/* KPI grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canCreate && (
              <KpiCard
                label="My Pending Requests"
                value={myPendingRequests}
                sub="Awaiting review"
              />
            )}
            {canApprove && (
              <KpiCard
                label="Pending Approvals"
                value={approvalItems.length}
                sub="Items to review"
              />
            )}
            {canPurchase && (
              <KpiCard
                label="Items to Order"
                value={purchaseItems.length}
                sub="Approved &amp; ready"
              />
            )}
            {canReturns && (
              <KpiCard
                label="Pending Returns"
                value={returnItems.length}
                sub="Returns to process"
              />
            )}
          </div>

          {/* Recent activity */}
          <div className="grid gap-3">
            <h2 className="text-base font-semibold text-foreground">Recent Activity</h2>
            {recentItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No requests yet. Submit a purchase request to get started.
              </p>
            ) : (
              recentItems.map(req => (
                <div
                  key={req.id}
                  className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {req.requester_name ?? req.requester_email ?? 'Request'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatDate(req.updated_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default DashboardPage
