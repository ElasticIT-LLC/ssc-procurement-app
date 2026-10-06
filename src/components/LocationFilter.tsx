// z8ygbxr03a/03b: segment-style location filter (All + each location), styled
// like the Requests status tabs. Hidden entirely when there are no locations.
interface LocationFilterProps {
  locations: string[]
  value: string
  onChange: (v: string) => void
}

export function LocationFilter({ locations, value, onChange }: LocationFilterProps) {
  if (locations.length === 0) return null
  const tabs = ['all', ...locations]
  return (
    <div className="flex overflow-x-auto gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            value === t
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t === 'all' ? 'All locations' : t}
        </button>
      ))}
    </div>
  )
}
