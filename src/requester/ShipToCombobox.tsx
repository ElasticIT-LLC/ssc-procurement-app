import { useEffect, useRef, useState } from 'react'
import { ShipToWorker } from '../data/db'

interface ShipToComboboxProps {
  value: string
  onChange: (v: string) => void
  workers: ShipToWorker[]
  loading: boolean
  onRefresh: () => void
}

// Searchable dropdown over active Rippling workers with a free-text fallback.
// Typing updates the value live (so any typed name is captured even if it matches
// no worker); selecting a worker sets the "First Last (Location)" label. If the
// worker list is empty (proxy failed), it behaves as a plain text input.
export function ShipToCombobox({ value, onChange, workers, loading, onRefresh }: ShipToComboboxProps) {
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

  const q = query.trim().toLowerCase()
  const matches = q ? workers.filter((w) => w.label.toLowerCase().includes(q)) : workers
  const showUseTyped = query.trim().length > 0 && !workers.some((w) => w.label === query.trim())

  function commit(v: string) { onChange(v); setQuery(v); setOpen(false) }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[highlight]) commit(matches[highlight].label); else if (query.trim()) commit(query.trim()) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          placeholder={loading ? 'Loading workers…' : 'Search a name or type one'}
          onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); setHighlight(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh worker list from Rippling"
          aria-label="Refresh worker list"
          className="h-9 shrink-0 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      {open && (matches.length > 0 || showUseTyped) && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg" role="listbox">
          {matches.map((w, i) => (
            <li
              key={w.id}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => { e.preventDefault(); commit(w.label) }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3 py-1.5 text-sm text-foreground ${i === highlight ? 'bg-primary/10' : ''}`}
            >
              {w.label}
            </li>
          ))}
          {showUseTyped && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => { e.preventDefault(); commit(query.trim()) }}
              className="cursor-pointer border-t border-border px-3 py-1.5 text-sm text-muted-foreground"
            >
              Use "{query.trim()}"
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
