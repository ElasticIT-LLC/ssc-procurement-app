import { useEffect, useRef, useState } from 'react'
import { FavoriteItem } from '../data/db'

// Pure: case-insensitive substring filter over the favorites catalog.
// Empty/whitespace query returns the full list.
export function filterFavorites(favorites: FavoriteItem[], query: string): FavoriteItem[] {
  const q = query.trim().toLowerCase()
  return q ? favorites.filter((f) => f.name.toLowerCase().includes(q)) : favorites
}

interface ItemNameComboboxProps {
  value: string
  onChange: (v: string, url?: string | null) => void
  favorites: FavoriteItem[]
}

// Searchable dropdown over the admin-curated favorites catalog with a
// free-text fallback (mirrors ShipToCombobox). Typing updates the value live,
// so any typed name is captured even if it matches no favorite. Selecting a
// favorite sets the name and, when present, the favorite's item URL.
// If the list is empty (or failed to load), it behaves as a plain text input.
export function ItemNameCombobox({ value, onChange, favorites }: ItemNameComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Keep the visible text in sync if the parent value changes externally.
  useEffect(() => { setQuery(value) }, [value])

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = filterFavorites(favorites, query)

  function commit(fav: FavoriteItem) { onChange(fav.name, fav.item_url); setQuery(fav.name); setOpen(false) }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, Math.max(matches.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[highlight]) commit(matches[highlight]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder={favorites.length ? 'Type an item name or pick a favorite' : 'e.g. Dell 27" Monitor'}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); setHighlight(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg" role="listbox">
          {matches.map((f, i) => (
            <li
              key={f.id}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => { e.preventDefault(); commit(f) }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3 py-1.5 text-sm text-foreground ${i === highlight ? 'bg-primary/10' : ''}`}
            >
              {f.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
