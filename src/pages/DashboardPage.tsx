import { useState, useEffect, useCallback } from 'react'
import { useShellContext } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { Chart, exportCsv } from '@elasticit-llc/ui-kit'
import * as XLSX from 'xlsx'
import { useProcurementApi, RequestRow, LineItemDetailed, Location } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { Modal } from '../components/Modal'
import { PERMS, formatDate, REQUEST_STATUS, LINE_ITEM_STATUS } from '../lib/constants'
import { countByStatusList, requestsByMonth, itemsByLocation } from '../dashboard/stats'
import {
  filterRequestsByStatus,
  filterRequestsByMonth,
  filterItemsByStatus,
  filterItemsByLocation,
  myPendingRequests,
} from '../dashboard/drilldown'
import { formatRequestNo, formatItemRef } from '../lib/itemRef'

type Drilldown =
  | { title: string; kind: 'request'; rows: RequestRow[] }
  | { title: string; kind: 'item'; rows: LineItemDetailed[] }

interface KpiCardProps {
  label: string
  value: number
  sub: string
  onClick: () => void
}

function KpiCard({ label, value, sub, onClick }: KpiCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to view details"
      className="rounded-lg border border-border bg-card px-4 py-3 flex-1 min-w-0 text-left hover:bg-muted transition-colors cursor-pointer"
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1 leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </button>
  )
}

const cell = 'px-3 py-2 text-xs text-foreground border-b border-border'
const head = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'

function RequestDrilldownRows({ rows }: { rows: RequestRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No requests match.</p>
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={head}>Req</th>
          <th className={head}>Requester</th>
          <th className={head}>Status</th>
          <th className={head}>Submitted</th>
          <th className={head}>Items</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td className={cell}>{formatRequestNo(r.request_number)}</td>
            <td className={cell}>{r.requester_name ?? r.requester_email ?? '—'}</td>
            <td className={cell}><StatusBadge status={r.status} /></td>
            <td className={cell}>{formatDate(r.submitted_at)}</td>
            <td className={cell}>{r.line_items?.length ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ItemDrilldownRows({ rows }: { rows: LineItemDetailed[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No items match.</p>
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={head}>Item</th>
          <th className={head}>Description</th>
          <th className={head}>Qty</th>
          <th className={head}>Requester</th>
          <th className={head}>Status</th>
          <th className={head}>Submitted</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(i => (
          <tr key={i.id}>
            <td className={cell}>{formatItemRef(i.request.request_number, i.line_no)}</td>
            <td className={cell}>{i.item_description || '—'}</td>
            <td className={cell}>{i.quantity}</td>
            <td className={cell}>{i.request.requester_name ?? i.request.requester_email ?? '—'}</td>
            <td className={cell}><StatusBadge status={i.status} /></td>
            <td className={cell}>{formatDate(i.request.submitted_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface DrilldownTable {
  headers: string[]
  rows: Record<string, string | number>[]
}

function drilldownTable(drill: Drilldown): DrilldownTable {
  if (drill.kind === 'request') {
    return {
      headers: ['Request', 'Requester', 'Status', 'Submitted', 'Items'],
      rows: drill.rows.map(r => ({
        Request: formatRequestNo(r.request_number),
        Requester: r.requester_name ?? r.requester_email ?? '—',
        Status: r.status,
        Submitted: formatDate(r.submitted_at),
        Items: r.line_items?.length ?? 0,
      })),
    }
  }
  return {
    headers: ['Item', 'Description', 'Qty', 'Requester', 'Status', 'Submitted'],
    rows: drill.rows.map(i => ({
      Item: formatItemRef(i.request.request_number, i.line_no),
      Description: i.item_description ?? '—',
      Qty: i.quantity,
      Requester: i.request.requester_name ?? i.request.requester_email ?? '—',
      Status: i.status,
      Submitted: formatDate(i.request.submitted_at),
    })),
  }
}

function drilldownSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function DashboardPage() {
  const { user } = useShellContext()
  const { hasAppPermission } = useAppPermissions()
  const api = useProcurementApi()

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [items, setItems] = useState<LineItemDetailed[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null)

  const canApprove = hasAppPermission(PERMS.approve)
  const canPurchase = hasAppPermission(PERMS.purchase)
  const canReturns = hasAppPermission(PERMS.returns)
  const canCreate = hasAppPermission(PERMS.create)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [reqs, itemCount, allItems, locs] = await Promise.all([
        api.listRequests(),
        api.countLineItems(),
        api.listAllLineItemsDetailed(),
        api.listAllLocations(),
      ])
      setRequests(reqs as RequestRow[])
      setTotalItems(itemCount as number)
      setItems(allItems as LineItemDetailed[])
      setLocations(locs as Location[])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const myPending = myPendingRequests(requests, user?.id, user?.email)
  const recentItems = requests.slice(0, 5)
  const reqStatusData = countByStatusList(requests, REQUEST_STATUS)
  const itemStatusData = countByStatusList(items, LINE_ITEM_STATUS)
  const reqMonthData = requestsByMonth(requests)
  const locationNames = Object.fromEntries(locations.map(l => [l.id, l.name]))
  const itemLocationData = itemsByLocation(items, locationNames)
  const approvalItems = filterItemsByStatus(items, ['pending', 'on_hold'])
  const purchaseItems = filterItemsByStatus(items, ['approved'])
  const returnItems = filterItemsByStatus(items, ['returned'])

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
          {/* KPI row — all cards on one line, each an equal share of the width, clickable */}
          <div className="flex gap-3">
            <KpiCard
              label="Total Items"
              value={totalItems}
              sub="Across all requests"
              onClick={() => setDrilldown({ title: `Total Items (${totalItems})`, kind: 'item', rows: items })}
            />
            {canCreate && (
              <KpiCard
                label="My Pending Requests"
                value={myPending.length}
                sub="Awaiting review"
                onClick={() => setDrilldown({ title: `My Pending Requests (${myPending.length})`, kind: 'request', rows: myPending })}
              />
            )}
            {canApprove && (
              <KpiCard
                label="Pending Approvals"
                value={approvalItems.length}
                sub="Items to review"
                onClick={() => setDrilldown({ title: `Pending Approvals (${approvalItems.length})`, kind: 'item', rows: approvalItems })}
              />
            )}
            {canPurchase && (
              <KpiCard
                label="Items to Order"
                value={purchaseItems.length}
                sub="Approved &amp; ready"
                onClick={() => setDrilldown({ title: `Items to Order (${purchaseItems.length})`, kind: 'item', rows: purchaseItems })}
              />
            )}
            {canReturns && (
              <KpiCard
                label="Pending Returns"
                value={returnItems.length}
                sub="Returns to process"
                onClick={() => setDrilldown({ title: `Pending Returns (${returnItems.length})`, kind: 'item', rows: returnItems })}
              />
            )}
          </div>

          {/* Charts — each segment clickable to drill down */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests by Status</h3>
              <Chart
                type="pie"
                data={reqStatusData as unknown as Record<string, unknown>[]}
                xKey="status"
                yKey="count"
                height={240}
                onPointClick={(status) => setDrilldown({ title: `Requests — ${status}`, kind: 'request', rows: filterRequestsByStatus(requests, status) })}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Items by Status</h3>
              <Chart
                type="bar"
                data={itemStatusData as unknown as Record<string, unknown>[]}
                xKey="status"
                yKey="count"
                height={240}
                onPointClick={(status) => setDrilldown({ title: `Items — ${status}`, kind: 'item', rows: filterItemsByStatus(items, [status]) })}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests Over Time</h3>
              <Chart
                type="area"
                data={reqMonthData as unknown as Record<string, unknown>[]}
                xKey="month"
                yKey="count"
                height={240}
                onPointClick={(month) => setDrilldown({ title: `Requests in ${month}`, kind: 'request', rows: filterRequestsByMonth(requests, month) })}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Items by Location</h3>
              <Chart
                type="bar"
                data={itemLocationData as unknown as Record<string, unknown>[]}
                xKey="location"
                yKey="count"
                height={240}
                onPointClick={(location) => setDrilldown({ title: `Items at ${location}`, kind: 'item', rows: filterItemsByLocation(items, locationNames, location) })}
              />
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
                      Updated {formatDate(req.updated_at)}
                    </p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
              ))
            )}
          </div>
        </>
      )}

      {drilldown && (
        <Modal title={drilldown.title} onClose={() => setDrilldown(null)}>
          <div className="flex justify-end gap-2 mb-3">
            <button
              type="button"
              onClick={() => {
                const table = drilldownTable(drilldown)
                exportCsv(
                  table.rows,
                  table.headers.map(h => ({ key: h, header: h })),
                  `procurement-${drilldownSlug(drilldown.title)}.csv`
                )
              }}
              className="rounded border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted transition-colors"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => {
                const table = drilldownTable(drilldown)
                const ws = XLSX.utils.json_to_sheet(table.rows)
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Report')
                XLSX.writeFile(wb, `procurement-${drilldownSlug(drilldown.title)}.xlsx`)
              }}
              className="rounded border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted transition-colors"
            >
              Download Excel
            </button>
          </div>
          {drilldown.kind === 'request'
            ? <RequestDrilldownRows rows={drilldown.rows} />
            : <ItemDrilldownRows rows={drilldown.rows} />}
        </Modal>
      )}
    </div>
  )
}

export default DashboardPage
