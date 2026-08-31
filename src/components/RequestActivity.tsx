import type { TimelineEvent } from '../lib/timeline'
import { formatDate } from '../lib/constants'

const TIME_FMT: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }

interface RequestActivityProps {
  events: TimelineEvent[]
}

export function RequestActivity({ events }: RequestActivityProps) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>
  return (
    <ol className="grid gap-2">
      {events.map((e) => (
        <li key={e.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
          <div className="grid gap-0.5">
            <p className="text-sm text-foreground">
              {e.label}
              {e.badge && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{e.badge.replace(/_/g, ' ')}</span>}
            </p>
            {e.detail && <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">{e.detail}</p>}
          </div>
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{e.at ? formatDate(e.at, TIME_FMT) : '—'}</span>
        </li>
      ))}
    </ol>
  )
}

export default RequestActivity
