import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, PurchaseOrderRow, FavoriteItem, LineItemWithRequest } from '../data/db'
import { useAppPermissions } from '../lib/useAppPermissions'
import { StatusBadge } from '../requester/StatusBadge'
import { ReplacementBadge } from '../requester/ReplacementBadge'
import { PERMS, formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'

export function ClosedOrders() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()
  const isAdmin = hasAppPermission(PERMS.admin)
  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [heartBusyId, setHeartBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setPos(await api.listPurchaseOrders('closed')) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed to load closed orders') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Best-effort: a failed favorites fetch never blocks the closed orders view.
    api.listFavorites().then(setFavorites).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const favoriteOf = (item: { item_description: string | null }) =>
    favorites.find(
      (f) =>
        f.name.trim().toLowerCase() ===
        (item.item_description ?? '').trim().toLowerCase(),
    )

  const isFavorite = (item: { item_description: string | null }) => favoriteOf(item) !== null

  async function handleHeart(item: LineItemWithRequest) {
    const name = item.item_description?.trim()
    if (!name) return
    const existing = favoriteOf(item)
    if (existing) {
      if (!isAdmin) {
        showToast({
          message: 'Already in favorites — an admin can remove it in Purchasing → Favorites',
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

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  if (error) return <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
  if (pos.length === 0) return <p className="text-sm text-muted-foreground">No closed orders.</p>

  return (
    <div className="grid gap-4">
      {pos.map(po => (
        <div key={po.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{po.po_number}{po.vendor ? ` · ${po.vendor}` : ''}</p>
            <p className="text-xs text-muted-foreground">Closed {po.closed_at ? formatDate(po.closed_at) : ''} · {po.line_items.length} item{po.line_items.length === 1 ? '' : 's'}</p>
          </div>
          <div className="grid gap-2">
            {po.line_items.map(item => (
              <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
                <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                <div className="flex items-center gap-2">
                  {item.item_description?.trim() && (
                    <button
                      type="button"
                      onClick={() => handleHeart(item)}
                      disabled={heartBusyId === item.id}
                      title={isFavorite(item) ? 'Remove from favorites' : 'Add to favorites'}
                      aria-label={isFavorite(item) ? 'Remove from favorites' : 'Add to favorites'}
                      className={`text-base leading-none rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
                        isFavorite(item)
                          ? 'text-destructive border-destructive/40 bg-destructive/10'
                          : 'text-muted-foreground border-border hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5'
                      }`}
                    >
                      {isFavorite(item) ? '♥' : '♡'}
                    </button>
                  )}
                  <ReplacementBadge item={item} />
                  <StatusBadge status={item.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
