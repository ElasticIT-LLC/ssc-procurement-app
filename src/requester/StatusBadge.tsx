import { STATUS_TONE } from '../lib/constants'

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const tone = STATUS_TONE[status] ?? 'bg-muted text-muted-foreground'
  const label = status.replace(/_/g, ' ')
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tone} ${className}`}
    >
      {label}
    </span>
  )
}
