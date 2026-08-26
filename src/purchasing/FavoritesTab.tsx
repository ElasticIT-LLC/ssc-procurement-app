import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, FavoriteItem } from '../data/db'
import { useAppPermissions } from '../lib/useAppPermissions'
import { PERMS, formatDate } from '../lib/constants'

// Curated shared reorder catalog, surfaced as auto-suggestions in request forms
// and readable by everyone. Approvers, purchasers, and admins can add items
// (RLS migration 032); removing stays admin-only. Reached from Purchasing →
// Favorite Items and Approvals → Favorite Items.
export function FavoritesTab() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()
  const isAdmin = hasAppPermission(PERMS.admin)

  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFavorites(await api.listFavorites())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load favorites')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (adding) return
    if (!name) {
      showToast({ message: 'Item name is required', type: 'error' })
      return
    }
    setAdding(true)
    try {
      await api.addFavorite(name, newUrl.trim() || null)
      showToast({ message: `Added "${name}" to favorites`, type: 'success' })
      setNewName('')
      setNewUrl('')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add favorite'
      showToast({ message: /uq_favorite|duplicate/i.test(msg) ? 'An item with that name already exists' : msg, type: 'error' })
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(fav: FavoriteItem) {
    if (!window.confirm(`Remove "${fav.name}" from favorites?`)) return
    setRemovingId(fav.id)
    try {
      await api.removeFavorite(fav.id)
      showToast({ message: 'Favorite removed', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to remove favorite', type: 'error' })
    } finally {
      setRemovingId(null)
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={handleAdd} className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Item name (required)"
          className="h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="url"
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          placeholder="Item URL (optional)"
          className="h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={adding}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add Favorite'}
        </button>
      </form>

      {favorites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No favorite items yet. Add a standard item so it's suggested in request forms.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Name</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">URL</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Added</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {favorites.map(fav => (
                <tr key={fav.id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-foreground">{fav.name}</td>
                  <td className="px-3 py-2 text-xs">
                    {fav.item_url ? (
                      <a href={fav.item_url} target="_blank" rel="noreferrer" className="text-primary underline break-all">{fav.item_url}</a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(fav.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {isAdmin ? (
                      <button
                        type="button"
                        disabled={removingId === fav.id}
                        onClick={() => handleRemove(fav)}
                        className="inline-flex items-center rounded-md bg-destructive/15 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
