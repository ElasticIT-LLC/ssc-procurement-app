// z8ygbxr03a/03b (v3.1): single-select location chip filter, styled like the
// Requests status tabs. "All (n)" clears the filter. The row is hidden
// entirely when the current view has no locations.
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
    <div className="flex overflow-x-auto gap-1 border-b border-border">
      {chips.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            value === c.value
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {c.value === 'all' ? 'All' : c.value} ({c.count})
        </button>
      ))}
    </div>
  )
}
