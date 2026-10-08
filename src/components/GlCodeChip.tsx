import { useEffect, useReducer, useRef, useState } from 'react'
import { groupGlCategories, type GlCategory } from '../lib/glCategories'
import { glChipReducer, GL_CHIP_INIT } from '../lib/glChipState'

interface GlCodeChipProps {
  value: string // '' = unset (parent-owned)
  onChange: (code: string) => void
  categories: GlCategory[]
  // Advisory suggest (edge fn). null = manual-only (e.g. GL edit on an existing item).
  suggest: ((input: { name: string; url: string; memo: string }) => Promise<string | null>) | null
  itemName: string
  itemUrl: string
  itemMemo: string
  disabled?: boolean
}

const SUGGEST_DEBOUNCE_MS = 1500

// Live GL suggestion chip for request forms (in-app + private) and the
// pre-approved catalog.
// Semantics: auto-suggestion triggers ONLY on item-name changes (never on mount,
// so pre-existing values — e.g. a catalog row with an admin-set code — are left
// alone). A name change discards any previous pick/suggestion (onChange('')),
// then schedules a debounced suggestion. A late AI reply (stale token) never
// overwrites a value the user picked.
export function GlCodeChip({ value, onChange, categories, suggest, itemName, itemUrl, itemMemo, disabled }: GlCodeChipProps) {
  const [state, dispatch] = useReducer(glChipReducer, GL_CHIP_INIT)
  const [open, setOpen] = useState(false)
  const firstRun = useRef(true)
  const valueRef = useRef(value)
  valueRef.current = value
  // Mirrors the reducer's token (both start at 0; INPUT_CHANGED + USER_PICKED
  // bump it): captured at fire time, compared after the async call to drop
  // stale replies.
  const tokenRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    dispatch({ type: 'INPUT_CHANGED', name: itemName })
    tokenRef.current += 1
    if (valueRef.current !== '') onChange('') // discard the stale pick/suggestion for the new item
    if (!itemName.trim() || !suggest) return
    const myToken = tokenRef.current
    const input = { name: itemName, url: itemUrl, memo: itemMemo } // context at fire time
    timerRef.current = window.setTimeout(async () => {
      let code: string | null = null
      try {
        code = await suggest(input)
      } catch {
        code = null
      }
      if (tokenRef.current !== myToken) return // re-typed or picked while in flight
      if (code) {
        dispatch({ type: 'SUGGESTED', token: myToken, code })
        onChange(code)
      } else {
        dispatch({ type: 'SUGGEST_FAILED', token: myToken })
      }
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
    // itemUrl/itemMemo are read at fire time (suggestion context), not triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemName, suggest])

  function handlePick(code: string) {
    dispatch({ type: 'USER_PICKED', code })
    tokenRef.current += 1
    onChange(code)
    setOpen(false)
  }

  const inert = categories.length === 0 && !suggest
  const label =
    state.phase === 'suggesting'
      ? 'Suggesting…'
      : state.phase === 'unavailable'
        ? (value ? `${value} · auto-classify unavailable` : 'auto-classify unavailable')
        : value
          ? `${value}${state.phase === 'suggested' ? ' · AI' : state.phase === 'edited' ? ' · edited' : ''}`
          : 'Pick GL code…'

  return (
    <div className="relative">
      {inert ? (
        <span className="text-xs text-muted-foreground">GL code unavailable</span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-label="GL code"
          className={`inline-flex max-w-full items-center truncate rounded-full border px-3.5 py-2 text-xs font-medium leading-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            open ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'
          }`}
        >
          {label}
        </button>
      )}
      {open && !inert && (
        <select
          autoFocus
          value={value}
          onChange={(e) => handlePick(e.target.value)}
          onBlur={() => setOpen(false)}
          className="absolute z-10 mt-1 w-full min-w-[280px] rounded-md border border-border bg-card p-2 text-xs text-foreground shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— No GL code —</option>
          {groupGlCategories(categories.map((c) => c.code)).map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.codes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  )
}
