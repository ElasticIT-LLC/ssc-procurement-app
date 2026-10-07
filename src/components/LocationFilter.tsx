// z8ygbxr03a/03b (v3.1): single-select location chip filter. Pill/ellipse
// chip layout per client reference (FilterChips: wrap row, 8px gap, fully
// rounded chips, filled primary when active). "All · n" clears the filter.
// The row is hidden entirely when the current view has no locations.
interface LocationFilterProps {
  options: { value: string; count: number }[]
  total: number
  value: string
  onChange: (v: string) => void
}

export function LocationFilter({ options, total, value, onChange }: LocationFilterProps) {
  if (options.length === 0) return null
  const chips = [{ value: 'all', count: total }, ...options]
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by location">
      {chips.map((c) => {
        const active = value === c.value
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.value)}
            className={`inline-flex items-center whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-medium leading-none transition-colors ${
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted'
            }`}
          >
            {c.value === 'all' ? 'All' : c.value} · {c.count}
          </button>
        )
      })}
    </div>
  )
}
