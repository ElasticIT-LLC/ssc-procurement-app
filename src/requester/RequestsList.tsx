import { useState, useEffect } from 'react'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useShellContext, useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, RequestRow, FavoriteItem } from '../data/db'
import { PERMS, formatDate, REQUEST_STATUS, FULL_ACCESS } from '../lib/constants'
import { formatRequestNo } from '../lib/itemRef'
import { countByStatus, filterByStatus } from '../lib/requestFilter'
import { StatusBadge } from './StatusBadge'
import { FavoritesLink } from '../components/FavoritesModal'
import { useFormattingRules } from '../formatting/useFormattingRules'

interface RequestsListProps {
  onNew: () => void
  onSelect: (id: string) => void
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
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [heartBusyId, setHeartBusyId] = useState<string | null>(null)
  const counts = countByStatus(requests)
  const visible = filterByStatus(requests, tab)
  const TABS = ['all', ...REQUEST_STATUS] as const

  useEffect(() => {
    setLoading(true)
    setError(null)
    const load = async () => {
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
    }
    load()
      .then((rows) => setRequests(rows))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load requests'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellUser?.id, shellUser?.email, canSeeAll])

  useEffect(() => {
    // Best-effort: a failed favorites fetch never blocks the request list.
    api.listFavorites().then(setFavorites).catch(() => {})
  }, [])

  const favoriteOf = (name: string) =>
    favorites.find(
      (f) => f.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )

  // The card heart favorites the first named item — the same one shown in the
  // card title. Multi-item requests: heart the rest from the detail view.
  const firstNamedItem = (req: RequestRow) =>
    (req.line_items ?? []).find((li) => li.item_description?.trim())

  async function handleHeartCard(req: RequestRow) {
    const item = firstNamedItem(req)
    if (!item?.item_description) return
    const name = item.item_description.trim()
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{canSeeAll ? 'All Requests' : 'My Requests'}</h2>
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

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          No requests in this view.
        </div>
      ) : (
        <div className="grid gap-2">
          {visible.map((req) => {
            const heartName = firstNamedItem(req)?.item_description?.trim()
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
                          handleHeartCard(req)
                        }}
                        disabled={heartBusyId === req.id}
                        title={isHeartFav ? 'In the shared favorites list' : `Add "${heartName}" to the shared favorites list`}
                        aria-label={isHeartFav ? 'Remove from favorites' : 'Add to favorites'}
                        className={`text-base leading-none rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
                          isHeartFav
                            ? 'text-destructive border-destructive/40 bg-destructive/10'
                            : 'text-muted-foreground border-border hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5'
                        }`}
                      >
                        {isHeartFav ? '♥' : '♡'}
                      </button>
                    )}
                    <StatusBadge status={req.status} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>Submitted: {formatDate(req.submitted_at)}</span>
                  <span>Updated: {formatDate(req.updated_at)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
