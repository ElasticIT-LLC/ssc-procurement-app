import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, RequestRow, LineItemRow, FavoriteItem, type RequestCommentRow } from '../data/db'
import { useAppPermissions } from '../lib/useAppPermissions'
import { StatusBadge } from './StatusBadge'
import { ReplacementBadge } from './ReplacementBadge'
import { ReturnForm } from './ReturnForm'
import { HeartIcon } from '../components/HeartIcon'
import { PERMS, formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'
import { RequestActivity } from '../components/RequestActivity'
import { RequestThread } from '../components/RequestThread'
import { buildTimeline } from '../lib/timeline'

interface RequestDetailProps {
  requestId: string
  onBack: () => void
}

export function RequestDetail({ requestId, onBack }: RequestDetailProps) {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()
  const isAdmin = hasAppPermission(PERMS.admin)
  // Only approvers, purchasers, and admins can curate the shared favorites list.
  const canCurate = isAdmin || hasAppPermission(PERMS.approve) || hasAppPermission(PERMS.purchase)

  const [request, setRequest] = useState<RequestRow | null>(null)
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [returnOpenId, setReturnOpenId] = useState<string | null>(null)
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [heartBusyId, setHeartBusyId] = useState<string | null>(null)
  const [comments, setComments] = useState<RequestCommentRow[]>([])
  const [approvedNames, setApprovedNames] = useState<Record<string, string>>({})

  useEffect(() => {
    // Best-effort: a failed favorites fetch never blocks the request view.
    api.listFavorites().then(setFavorites).catch(() => {})
  }, [requestId])

  const favoriteOf = (item: LineItemRow) =>
    favorites.find(
      (f) =>
        f.name.trim().toLowerCase() ===
        (item.item_description ?? '').trim().toLowerCase(),
    )

  const isFavorite = (item: LineItemRow) => favoriteOf(item) !== undefined

  async function handleHeart(item: LineItemRow) {
    const name = item.item_description?.trim()
    if (!name) return
    const existing = favoriteOf(item)
    if (existing) {
      if (!isAdmin) {
        showToast({
          message: 'Already in favorites — an admin can remove it in the Favorite Items tab',
          type: 'info',
        })
        return
      }
      setHeartBusyId(item.id)
      try {
        await api.removeFavorite(existing.id)
        setFavorites(await api.listFavorites())
        showToast({ message: 'Removed from favorites', type: 'success' })
      } catch (err: unknown) {
        showToast({
          message: err instanceof Error ? err.message : 'Failed to remove from favorites',
          type: 'error',
        })
      } finally {
        setHeartBusyId(null)
      }
      return
    }
    setHeartBusyId(item.id)
    try {
      await api.addFavorite(name, item.item_url ?? undefined)
      setFavorites(await api.listFavorites())
        showToast({ message: 'Added to favorites — now visible to everyone', type: 'success' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (/unique|23505/i.test(msg)) {
        setFavorites(await api.listFavorites().catch(() => favorites))
        showToast({ message: 'Already in favorites', type: 'info' })
      } else {
        showToast({
          message: msg || 'Failed to add to favorites',
          type: 'error',
        })
      }
    } finally {
      setHeartBusyId(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [req, items, cmts] = await Promise.all([
        api.getRequest(requestId),
        api.listLineItems(requestId),
        api.listRequestComments(requestId),
      ])
      setRequest(req)
      setLineItems(items)
      setComments(cmts)
      const approvers = Array.from(new Set(items.map((i) => i.approved_by).filter((x): x is string => !!x)))
      if (approvers.length) setApprovedNames(await api.resolveUserNames(approvers))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load request')
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let poll: number | undefined
    const stop = api.subscribeRequestComments(
      requestId,
      () => { void api.listRequestComments(requestId).then(setComments).catch(() => {}) },
      () => {
        if (poll === undefined) {
          poll = window.setInterval(() => {
            void api.listRequestComments(requestId).then(setComments).catch(() => {})
          }, 30000)
        }
      },
    )
    return () => { stop(); if (poll !== undefined) window.clearInterval(poll) }
  }, [requestId])

  const timeline = useMemo(
    () =>
      request
        ? buildTimeline({
            request,
            items: lineItems,
            comments,
            itemName: (li) => formatItemRef(request.request_number, li.line_no),
            nameOf: (id) => approvedNames[id] ?? 'Unknown',
          })
        : [],
    [request, lineItems, comments, approvedNames],
  )

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

      {/* Approver hint: this view has no approve/decline actions — they live on
          the Approvals page. Full navigation (like threadLink) so the shell
          reloads onto the approvals page. */}
      {hasAppPermission(PERMS.approve) && lineItems.some((i) => i.status === 'pending' || i.status === 'on_hold') && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-info/10 border border-info/30 px-3 py-2">
          <p className="text-xs text-info">
            Items in this request are waiting for a decision. Approve, decline, or hold them on the Approvals page.
          </p>
          <a
            href={window.location.pathname.replace(/[^/]+$/, 'approvals')}
            className="shrink-0 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Go to Approvals
          </a>
        </div>
      )}

      {/* Line items */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold text-foreground">Items ({lineItems.length})</h3>
        {lineItems.length === 0 && (
          <p className="text-sm text-muted-foreground">No items found.</p>
        )}
        {lineItems.map((item) => (
          <div key={item.id} className="rounded-lg border border-border bg-card p-4 grid gap-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {formatItemRef(request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}
                  <ReplacementBadge item={item} className="ml-2" />
                </p>
                <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                <p className="text-xs text-muted-foreground">
                  Substitution:{' '}
                  {item.substitution_ok ? (
                    'Yes'
                  ) : (
                    <span className="font-bold text-red-600">No</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.item_description?.trim() && canCurate && (
                  <button
                    type="button"
                    onClick={() => handleHeart(item)}
                    disabled={heartBusyId === item.id}
                    title={isFavorite(item) ? 'In the shared favorites list' : 'Add to the shared favorites list'}
                    aria-label={isFavorite(item) ? 'Remove from favorites' : 'Add to favorites'}
                    className={`text-base leading-none rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
                      isFavorite(item)
                        ? 'text-destructive border-destructive/40 bg-destructive/10'
                        : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/40 hover:bg-muted'
                    }`}
                  >
                    <HeartIcon filled={isFavorite(item)} />
                  </button>
                )}
                <StatusBadge status={item.status} />
              </div>
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

      {/* Activity history (C1 — derived timeline, no event log) */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold text-foreground">Activity</h3>
        <RequestActivity events={timeline} />
      </div>

      {/* Comment thread (C2) — full thread, @mention picker, realtime */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold text-foreground">Comments</h3>
        <RequestThread
          request={request}
          items={lineItems}
          comments={comments}
          onPosted={() => { void api.listRequestComments(requestId).then(setComments).catch(() => {}) }}
        />
      </div>
    </div>
  )
}
