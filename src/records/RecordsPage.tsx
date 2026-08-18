import { Fragment, useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useProcurementApi, LineItemDetailed, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { ReplacementBadge } from '../requester/ReplacementBadge'
import { ReturnForm } from '../requester/ReturnForm'
import { FULL_ACCESS, PERMS, formatDate } from '../lib/constants'
import { useFormattingRules } from '../formatting/useFormattingRules'

function locationName(item: LineItemDetailed): string {
  return item.location?.name ?? item.custom_location ?? '—'
}
function departmentName(item: LineItemDetailed): string {
  return item.department?.name ?? item.custom_department ?? '—'
}

function csvCell(value: string): string {
  // Quote and escape any cell that could break CSV structure.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function exportCsv(rows: LineItemDetailed[]) {
  const headers = ['Submitted', 'Requester', 'Email', 'Item', 'Qty', 'Location', 'Department', 'Status', 'Date Needed', 'ETA', 'Request Notes', 'Admin Comment']
  const lines = [headers.join(',')]
  for (const item of rows) {
    lines.push([
      formatDate(item.request.submitted_at),
      item.request.requester_name ?? '',
      item.request.requester_email ?? '',
      item.item_description ?? '',
      String(item.quantity),
      locationName(item),
      departmentName(item),
      item.status.replace(/_/g, ' '),
      formatDate(item.date_needed),
      formatDate(item.eta),
      item.request.notes ?? '',
      item.admin_comment ?? '',
    ].map(c => csvCell(c)).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `procurement-records-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function RecordsPage() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()
  const { toneClassFor } = useFormattingRules()

  const canComment = hasAppPermission(PERMS.approve) || hasAppPermission(PERMS.purchase) || hasAppPermission(PERMS.admin)
  const canDelete = hasAppPermission(FULL_ACCESS)
  const canReturn = hasAppPermission(PERMS.returns) || hasAppPermission(PERMS.admin)

  const [items, setItems] = useState<LineItemDetailed[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [returnOpenId, setReturnOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listAllLineItemsDetailed()
      setItems(data)
      setDrafts(Object.fromEntries(data.map(i => [i.id, i.admin_comment ?? ''])))
      const map = await api.resolveUserNames(data.map((r) => r.commented_by).filter((x): x is string => !!x))
      setNames(map)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSaveComment(id: string) {
    setBusyId(id)
    try {
      await api.setLineItemComment(id, drafts[id] ?? '')
      showToast({ message: 'Comment saved', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to save comment', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(item: LineItemDetailed) {
    if (!window.confirm(`Delete "${item.item_description ?? 'this item'}"? This cannot be undone.`)) return
    setBusyId(item.id)
    try {
      await api.deleteLineItem(item.id)
      showToast({ message: 'Item deleted', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to delete item', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  if (!hasAppPermission(PERMS.admin)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  const cell = 'px-3 py-2 align-top text-xs text-foreground'
  const head = 'px-3 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap'
  const showActionsColumn = canDelete || canReturn
  // 11 fixed columns (Submitted…Admin Comment) + the conditional Actions column.
  const columnCount = 11 + (showActionsColumn ? 1 : 0)

  return (
    <div className="grid gap-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground mb-1">Records</h1>
          <p className="text-muted-foreground text-sm">Every requested item, one row each.</p>
        </div>
        <button
          type="button"
          onClick={() => exportCsv(items)}
          disabled={items.length === 0}
          className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          Export CSV
        </button>
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
        <p className="text-sm text-muted-foreground">No records yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className={head}>Submitted</th>
                <th className={head}>Requester</th>
                <th className={head}>Item</th>
                <th className={head}>Qty</th>
                <th className={head}>Location</th>
                <th className={head}>Department</th>
                <th className={head}>Status</th>
                <th className={head}>Date Needed</th>
                <th className={head}>ETA</th>
                <th className={head}>Request Notes</th>
                <th className={head}>Admin Comment</th>
                {showActionsColumn && <th className={head}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <Fragment key={item.id}>
                  <tr className={`border-t border-border hover:bg-muted/30 ${toneClassFor(item as unknown as Record<string, unknown>)}`}>
                  <td className={`${cell} whitespace-nowrap`}>{formatDate(item.request.submitted_at)}</td>
                  <td className={cell}>
                    <div className="text-foreground">{item.request.requester_name ?? '—'}</div>
                    {item.request.requester_email && (
                      <div className="text-muted-foreground">{item.request.requester_email}</div>
                    )}
                  </td>
                  <td className={`${cell} max-w-[16rem]`}>
                    {item.item_url ? (
                      <a href={item.item_url} target="_blank" rel="noreferrer" className="text-primary underline break-words">
                        {item.item_description ?? item.item_url}
                      </a>
                    ) : (
                      <span className="break-words">{item.item_description ?? '—'}</span>
                    )}
                  </td>
                  <td className={cell}>{item.quantity}</td>
                  <td className={cell}>{locationName(item)}</td>
                  <td className={cell}>{departmentName(item)}</td>
                  <td className={cell}><span className="inline-flex flex-wrap items-center gap-1"><StatusBadge status={item.status} /><ReplacementBadge item={item} /></span></td>
                  <td className={`${cell} whitespace-nowrap`}>{formatDate(item.date_needed) || '—'}</td>
                  <td className={`${cell} whitespace-nowrap`}>{formatDate(item.eta) || '—'}</td>
                  <td className={`${cell} max-w-[14rem] text-muted-foreground`}>
                    <span className="break-words">{item.request.notes ?? '—'}</span>
                  </td>
                  <td className={`${cell} min-w-[12rem]`}>
                    {canComment ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-start gap-1.5">
                          <input
                            type="text"
                            value={drafts[item.id] ?? ''}
                            onChange={e => setDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Add comment…"
                            maxLength={100}
                            className="h-8 w-full rounded-md border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                          <button
                            type="button"
                            disabled={busyId === item.id || (drafts[item.id] ?? '') === (item.admin_comment ?? '')}
                            onClick={() => handleSaveComment(item.id)}
                            className="inline-flex shrink-0 items-center rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                        {item.commented_at && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">— {names[item.commented_by ?? ''] ?? 'Unknown'} · {formatDate(item.commented_at, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground break-words">{item.admin_comment ?? '—'}</span>
                    )}
                  </td>
                  {showActionsColumn && (
                    <td className={`${cell} whitespace-nowrap`}>
                      <div className="flex flex-wrap gap-1.5">
                        {canReturn && item.status === 'received' && (
                          <button
                            type="button"
                            onClick={() => setReturnOpenId(returnOpenId === item.id ? null : item.id)}
                            className="inline-flex items-center rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                          >
                            Return
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => handleDelete(item)}
                            className="inline-flex items-center rounded-md bg-destructive/15 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                  </tr>
                  {returnOpenId === item.id && (
                    <tr>
                      <td colSpan={columnCount} className="bg-muted/30 p-4">
                        <ReturnForm
                          item={item as unknown as LineItemWithRequest}
                          onDone={async () => { setReturnOpenId(null); await load() }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default RecordsPage
