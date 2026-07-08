import { useState, useEffect, useCallback } from 'react'
import { useShellContext } from '@elasticit-llc/app-bridge'
import { usePermissions } from '@elasticit-llc/app-bridge'
import { Chart } from '@elasticit-llc/ui-kit'
import { useProcurementApi, RequestRow, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { PERMS, formatDate, REQUEST_STATUS, LINE_ITEM_STATUS } from '../lib/constants'
import { countByStatusList, requestsByMonth } from '../dashboard/stats'

interface KpiCardProps {
  label: string
  value: number
  sub: string
}

function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 w-full">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1 leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </div>
  )
}

export function DashboardPage() {
  const { user } = useShellContext()
  const { hasPermission } = usePermissions()
  const api = useProcurementApi()

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [approvalItems, setApprovalItems] = useState<LineItemWithRequest[]>([])
  const [purchaseItems, setPurchaseItems] = useState<LineItemWithRequest[]>([])
  const [returnItems, setReturnItems] = useState<LineItemWithRequest[]>([])
  const [itemStatuses, setItemStatuses] = useState<{ status: string }[]>([])
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
      const fetches: Promise<unknown>[] = [api.listRequests(), api.countLineItems(), api.listLineItemStatuses()]
      if (canApprove) fetches.push(api.listLineItemsByStatus(['pending', 'on_hold']))
      if (canPurchase) fetches.push(api.listLineItemsByStatus(['approved']))
      if (canReturns) fetches.push(api.listLineItemsByStatus(['returned']))

      const [reqs, itemCount, statuses, ...rest] = await Promise.all(fetches)
      setRequests(reqs as RequestRow[])
      setTotalItems(itemCount as number)
      setItemStatuses(statuses as { status: string }[])

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
  const reqStatusData = countByStatusList(requests, REQUEST_STATUS)
  const itemStatusData = countByStatusList(itemStatuses, LINE_ITEM_STATUS)
  const reqMonthData = requestsByMonth(requests)

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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard
              label="Total Items"
              value={totalItems}
              sub="Across all requests"
            />
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

          {/* Charts */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests by Status</h3>
              <Chart type="pie" data={reqStatusData} xKey="status" yKey="count" height={240} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Items by Status</h3>
              <Chart type="bar" data={itemStatusData} xKey="status" yKey="count" height={240} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests Over Time</h3>
              <Chart type="area" data={reqMonthData} xKey="month" yKey="count" height={240} />
            </div>
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
