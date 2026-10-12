import { useState, useEffect, useCallback } from 'react'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useShellContext, useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, RequestRow, RequestLineItem, FavoriteItem, Location, Department } from '../data/db'
import { PERMS, formatDate, FULL_ACCESS } from '../lib/constants'
import { formatRequestNo } from '../lib/itemRef'
import { countByTab, filterByTab } from '../lib/requestFilter'
import { displayRequestStatus } from '../lib/requestDisplay'
import { resolveLocationName } from '../lib/locationLabel'
import { matchesRequest } from '../lib/requestSearch'
import { flattenToItemRows } from '../lib/requestGrouping'
import { StatusBadge } from './StatusBadge'
import { FavoritesLink } from '../components/FavoritesModal'
import { HeartIcon } from '../components/HeartIcon'
import { useFormattingRules } from '../formatting/useFormattingRules'
import { useSilentPoll } from '../lib/useSilentPoll'

interface RequestsListProps {
  onNew: () => void
  onSelect: (id: string) => void
}

type GroupBy = 'request' | 'item'

const GROUP_MODES: { value: GroupBy; label: string }[] = [
  { value: 'request', label: 'By request' },
  { value: 'item', label: 'By item' },
]

const GROUPBY_STORAGE_KEY = 'requests.groupBy'

function loadGroupBy(): GroupBy {
  try {
    return window.localStorage.getItem(GROUPBY_STORAGE_KEY) === 'item' ? 'item' : 'request'
  } catch {
    return 'request'
  }
}

export function RequestsList({ onNew, onSelect }: RequestsListProps) {
  const api = useProcurementApi()
  const { hasAppPermission } = useAppPermissions()
  const { user: shellUser } = useShellContext()
  const { showToast } = useToast()
  const { toneClassFor } = useFormattingRules()

  const canCreate = hasAppPermission(PERMS.create)
  const canSeeAll = hasAppPermission(FULL_ACCESS)
  const isAdmin = hasAppPermission(PERMS.admin)
  // Only approvers, purchasers, and admins can curate the shared favorites list.
  const canCurate = isAdmin || hasAppPermission(PERMS.approve) || hasAppPermission(PERMS.purchase)

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy)
  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [heartBusyId, setHeartBusyId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const counts = countByTab(requests)
  const visible = filterByTab(requests, tab)
  const searched = query.trim()
    ? visible.filter((r) => matchesRequest(query, r, { locations, departments }))
    : visible
  const TABS = ['all', 'pending', 'on_hold', 'partially_approved', 'approved', 'received', 'declined', 'cancelled'] as const

  const changeGroupBy = (g: GroupBy) => {
    setGroupBy(g)
    try {
      window.localStorage.setItem(GROUPBY_STORAGE_KEY, g)
    } catch {
      // Persistence is a convenience - never block the toggle on storage errors.
    }
  }

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    // Scope by the shell (effective) user, which reflects impersonation (preview as
    // target). The Supabase JWT stays the real operator during preview, so
    // auth.getUser() would return the operator and scope the list to the wrong person.
    // SSO users can have a NULL email on the auth record; the shell profile carries
    // the directory email, so use it to match public-form submissions.
    const id = shellUser?.id
    if (!id) throw new Error('Unable to identify current user')
    if (canSeeAll) return api.listRequests()
    const email = shellUser?.email || undefined
    return api.listRequests(id, email)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellUser?.id, shellUser?.email, canSeeAll])

  useEffect(() => {
    refresh()
      .then((rows) => setRequests(rows))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load requests'))
      .finally(() => setLoading(false))
  }, [refresh])

  // z8ygbxp4ch: silent 10s auto-refresh so new/updated requests appear without a
  // manual page refresh.
  useSilentPoll(() => refresh(true).then((rows) => setRequests(rows)), 10000)

  useEffect(() => {
    // Best-effort: a failed favorites fetch never blocks the request list.
    api.listFavorites().then(setFavorites).catch(() => {})
    // Best-effort: failed location/department fetches never block the list;
    // search + location text simply fall back to nothing.
    api.listLocations().then(setLocations).catch(() => {})
    api.listDepartments().then(setDepartments).catch(() => {})
  }, [])

  const favoriteOf = (name: string) =>
    favorites.find(
      (f) => f.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )

  // z8ygbxrhc (v4): per-card expand state for the per-item location rows
  // (by-request mode only). Not persisted - session convenience.
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // The card heart favorites the first named item — the same one shown in the
  // card title. Multi-item requests: heart the rest from the detail view.
  const firstNamedItem = (req: RequestRow) =>
    (req.line_items ?? []).find((li) => li.item_description?.trim())

  // Heart on a request card (the first named item) or on a "By item" row:
  // favorites that one named item.
  async function handleHeartItem(req: RequestRow, item: RequestLineItem) {
    const name = item.item_description?.trim()
    if (!name) return
    const existing = favoriteOf(name)
    if (existing) {
      if (!isAdmin) {
        showToast({
          message: 'Already in favorites — an admin can remove it in the Favorite Items tab',
          type: 'info',
        })
        return
      }
      setHeartBusyId(req.id)
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
    setHeartBusyId(req.id)
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
        showToast({ message: msg || 'Failed to add to favorites', type: 'error' })
      }
    } finally {
      setHeartBusyId(null)
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">{canSeeAll ? 'All Requests' : 'My Requests'}</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border" role="group" aria-label="Group requests by">
            {GROUP_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => changeGroupBy(mode.value)}
                aria-pressed={groupBy === mode.value}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  groupBy === mode.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
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
      </div>

      <FavoritesLink />

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

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search item, requester, request #, location..."
        aria-label="Search requests"
        className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          No requests in this view.
        </div>
      ) : searched.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          No requests match "{query}".
        </div>
      ) : groupBy === 'item' ? (
        <div className="grid gap-2">
          {flattenToItemRows(searched).map(({ request: req, item, key }) => {
            const name = item.item_description?.trim() || '(untitled item)'
            const loc = resolveLocationName(item, locations)
            const heartName = item.item_description?.trim()
            const isHeartFav = !!heartName && favoriteOf(heartName) !== undefined
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(req.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(req.id)
                  }
                }}
                className={`w-full text-left rounded-lg border border-border bg-card p-4 hover:bg-muted transition-colors grid gap-1 cursor-pointer ${toneClassFor(req as unknown as Record<string, unknown>)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {formatRequestNo(req.request_number)}
                    {' · '}
                    {name}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {heartName && canCurate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleHeartItem(req, item)
                        }}
                        disabled={heartBusyId === req.id}
                        title={isHeartFav ? 'In the shared favorites list' : `Add "${heartName}" to the shared favorites list`}
                        aria-label={isHeartFav ? 'Remove from favorites' : 'Add to favorites'}
                        className={`text-base leading-none rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
                          isHeartFav
                            ? 'text-destructive border-destructive/40 bg-destructive/10'
                            : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/40 hover:bg-muted'
                        }`}
                      >
                        <HeartIcon filled={isHeartFav} />
                      </button>
                    )}
                    <StatusBadge status={displayRequestStatus(req)} />
                  </div>
                </div>
                {loc && <div className="text-xs text-muted-foreground">{loc}</div>}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>Requested by {req.requester_name?.trim() || req.requester_email?.trim() || 'Unknown'}</span>
                  <span>Submitted: {formatDate(req.submitted_at)}</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid gap-2">
          {searched.map((req) => {
            const heartItem = firstNamedItem(req)
            const heartName = heartItem?.item_description?.trim()
            const isHeartFav = !!heartName && favoriteOf(heartName) !== undefined
            return (
              <div
                key={req.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(req.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(req.id)
                  }
                }}
                className={`w-full text-left rounded-lg border border-border bg-card p-4 hover:bg-muted transition-colors grid gap-1 cursor-pointer ${toneClassFor(req as unknown as Record<string, unknown>)}`}
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
                  <div className="flex items-center gap-2 shrink-0">
                    {heartName && canCurate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (heartItem) handleHeartItem(req, heartItem)
                        }}
                        disabled={heartBusyId === req.id}
                        title={isHeartFav ? 'In the shared favorites list' : `Add "${heartName}" to the shared favorites list`}
                        aria-label={isHeartFav ? 'Remove from favorites' : 'Add to favorites'}
                        className={`text-base leading-none rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
                          isHeartFav
                            ? 'text-destructive border-destructive/40 bg-destructive/10'
                            : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/40 hover:bg-muted'
                        }`}
                      >
                        <HeartIcon filled={isHeartFav} />
                      </button>
                    )}
                    <StatusBadge status={displayRequestStatus(req)} />
                    {(req.line_items?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleExpanded(req.id)
                        }}
                        aria-expanded={expandedIds.has(req.id)}
                        aria-label={expandedIds.has(req.id) ? 'Collapse item locations' : 'Expand item locations'}
                        title={expandedIds.has(req.id) ? 'Hide item locations' : 'Show item locations'}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {expandedIds.has(req.id) ? '▾' : '▸'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>Submitted: {formatDate(req.submitted_at)}</span>
                  <span>Updated: {formatDate(req.updated_at)}</span>
                  {req.line_items?.some((li) => li.gl_code) && (
                    <span>GL: {req.line_items!.find((li) => li.gl_code)!.gl_code}</span>
                  )}
                </div>
                {expandedIds.has(req.id) && (
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {(req.line_items ?? []).map((li, i) => (
                      <span key={li.line_no ?? i}>
                        Item {li.line_no ?? i + 1} — {resolveLocationName(li, locations) ?? '(no location)'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
