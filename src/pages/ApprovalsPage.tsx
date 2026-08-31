import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useProcurementApi, LineItemWithRequest, type RequestCommentRow } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { FavoritesTab } from '../purchasing/FavoritesTab'
import { PreApprovedTab } from '../approvals/PreApprovedTab'
import { PERMS, formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'

export function ApprovalsPage() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()

  const [items, setItems] = useState<LineItemWithRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [comments, setComments] = useState<RequestCommentRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [preApprovedNames, setPreApprovedNames] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'items' | 'preapproved' | 'favorites'>('items')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listLineItemsByStatus(['pending', 'on_hold'])
      setItems(data)
      const catalog = await api.listPreApprovedItems()
      setPreApprovedNames(new Set(catalog.map((c) => c.name.toLowerCase())))
      setComments(await api.listRequestCommentsMany(Array.from(new Set(data.map((i) => i.request.id)))))
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
      // C2: a note left on the card ships with the decision as a thread comment
      // (source 'approvals', item-scoped). Best-effort — a failed comment never undoes the decision.
      const draft = (drafts[id] ?? '').trim()
      let notePosted = false
      let noteFailed = false
      if (draft && reqId) {
        try {
          const row = await api.postRequestComment({ request_id: reqId, line_item_id: id, source: 'approvals', body: draft })
          api.fireCommentNotification(row.id)
          setDrafts((d) => ({ ...d, [id]: '' }))
          notePosted = true
        } catch (e) {
          console.error('Failed to post decision note as thread comment:', e)
          noteFailed = true
        }
      }
      const messages: Record<typeof action, string> = {
        approved: 'Item approved',
        declined: 'Item declined',
        on_hold: 'Item placed on hold',
      }
      const toastMsg = noteFailed ? `${messages[action]} — note could not be posted` : notePosted ? `${messages[action]} + note posted to thread` : messages[action]
      showToast({ message: toastMsg, type: noteFailed ? 'error' : 'success' })
      api.fireNotification(action === 'approved' ? 'item_approved' : 'item_declined', reqId, [id])
      const remaining = await api.listLineItemsByStatus(['pending', 'on_hold'])
      setItems(remaining)
      if (reqId && !remaining.some((it) => it.request.id === reqId)) await api.notifyApproved(reqId)
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Action failed', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  const commentsByRequest = useMemo(() => {
    const map: Record<string, RequestCommentRow[]> = {}
    for (const c of comments) (map[c.request_id] ??= []).push(c)
    return map
  }, [comments])
  const threadCountFor = (requestId: string) => (commentsByRequest[requestId] ?? []).length
  // The full thread lives on the Requests page (RequestDetail). Plain <a href> forces a
  // full navigation so the shell reloads on the requests page and RequestsPage reads ?request=<id>.
  const threadLink = (requestId: string) =>
    `${window.location.pathname.replace(/[^/]+$/, 'requests')}?request=${encodeURIComponent(requestId)}`

  async function saveComment(itemId: string) {
    const item = items.find((it) => it.id === itemId)
    if (!item) return
    const body = (drafts[itemId] ?? '').trim()
    if (!body) return
    setBusyId(itemId)
    try {
      const row = await api.postRequestComment({
        request_id: item.request.id,
        line_item_id: itemId,
        source: 'approvals',
        body,
      })
      api.fireCommentNotification(row.id)
      setDrafts((d) => ({ ...d, [itemId]: '' }))
      setComments(await api.listRequestCommentsMany(Array.from(new Set(items.map((i) => i.request.id)))))
      showToast({ message: 'Comment posted', type: 'success' })
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to post comment', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  async function handlePreApprove(item: LineItemWithRequest) {
    if (!window.confirm(`Pre-approve "${item.item_description || 'this item'}"?\nIt will be added to the pre-approved catalog. The item stays in For Approval until approved.`)) return
    setBusyId(item.id)
    try {
      await api.preApproveLineItem(item.id)
      showToast({ message: 'Added to pre-approved catalog', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Pre-approve failed', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  const canComment = hasAppPermission(PERMS.approve) || hasAppPermission(PERMS.purchase) || hasAppPermission(PERMS.admin)

  if (!hasAppPermission(PERMS.approve)) {
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

      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('items')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'items' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          For Approval
        </button>
        <button
          type="button"
          onClick={() => setTab('preapproved')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'preapproved' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Pre-approved
        </button>
        <button
          type="button"
          onClick={() => setTab('favorites')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'favorites' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Favorite Items
        </button>
      </div>

      {tab === 'items' && loading && (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
      )}

      {tab === 'items' && !loading && error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {tab === 'items' && !loading && !error && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No items pending approval.</p>
      )}

      {tab === 'items' && !loading && !error && items.map(item => (
        <div key={item.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
          {/* Header: description + status */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">
                {formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}
              </p>
              <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
              <p className="text-xs text-muted-foreground">Substitution: {item.substitution_ok ? 'Yes' : 'No'}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {preApprovedNames.has((item.item_description ?? '').toLowerCase()) && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">Pre-approved</span>
              )}
              <StatusBadge status={item.status} />
            </div>
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

          {/* Comment thread (C2) — posts to the request thread (source 'approvals') */}
          {canComment && (
            <div className="grid gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Comment</label>
                {threadCountFor(item.request.id) > 0 && (
                  <span className="text-[11px] text-muted-foreground">{threadCountFor(item.request.id)} in thread</span>
                )}
              </div>
              <textarea
                rows={2}
                maxLength={1000}
                value={drafts[item.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                placeholder="Add a note for the requester (posts with your decision, max 1000 chars)"
                className="w-full rounded-md border border-input bg-input px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <div className="flex items-center justify-between gap-2">
                <a href={threadLink(item.request.id)} className="text-[11px] text-primary underline">View full thread</a>
                <button
                  type="button"
                  disabled={busyId === item.id || !(drafts[item.id] ?? '').trim()}
                  onClick={() => { void saveComment(item.id) }}
                  className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >Post comment</button>
              </div>
            </div>
          )}

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
              onClick={() => handlePreApprove(item)}
              className="inline-flex items-center rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
            >
              Pre-approve
            </button>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handleAction(item.id, 'declined')}
              className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
            >
              Decline
            </button>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handleAction(item.id, 'on_hold')}
              className="inline-flex items-center rounded-md border border-warning/40 bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/25 disabled:opacity-50"
            >
              Hold
            </button>
          </div>
        </div>
        ))}

      {tab === 'preapproved' && <PreApprovedTab />}

      {tab === 'favorites' && <FavoritesTab />}
    </div>
  )
}

export default ApprovalsPage
