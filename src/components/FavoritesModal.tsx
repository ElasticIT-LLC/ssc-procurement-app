import { useEffect, useState } from 'react'
import { useProcurementApi, FavoriteItem } from '../data/db'
import { formatDate } from '../lib/constants'
import { Modal } from './Modal'
import { HeartIcon } from './HeartIcon'

interface FavoritesModalProps {
  open: boolean
  onClose: () => void
}

export function FavoritesModal({ open, onClose }: FavoritesModalProps) {
  const api = useProcurementApi()
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listFavorites()
      .then(async (rows) => {
        const ids = rows.map((f) => f.created_by).filter((x): x is string => !!x)
        const map = ids.length ? await api.resolveUserNames(ids).catch(() => ({})) : {}
        if (cancelled) return
        setFavorites(rows)
        setNames(map)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load favorites')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <Modal title="Favorite Items" onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-3">
        The shared reorder list — items marked with <HeartIcon filled /> in requests and orders. Approvers, purchasers, and admins can add items.
      </p>
      {loading ? (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
      ) : error ? (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
      ) : favorites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No favorite items yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Item</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Added by</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Added</th>
              </tr>
            </thead>
            <tbody>
              {favorites.map((fav) => (
                <tr key={fav.id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs">
                    {fav.item_url ? (
                      <a href={fav.item_url} target="_blank" rel="noreferrer" className="text-primary underline">
                        {fav.name}
                      </a>
                    ) : (
                      <span className="text-foreground">{fav.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {fav.created_by ? names[fav.created_by] || '—' : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(fav.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

// Small inline link that opens the favorites modal. Dropped under page/form
// titles so anyone filling out a request can check the shared item list.
export function FavoritesLink() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start justify-self-start text-xs text-muted-foreground underline hover:text-foreground"
      >
        <HeartIcon /> Favorite items — see the shared list
      </button>
      <FavoritesModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
