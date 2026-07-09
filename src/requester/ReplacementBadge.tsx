interface ReplacementBadgeProps {
  /** Any line item; the badge shows only when it was returned with a replacement requested. */
  item: { return_date: string | null; wants_replacement: boolean | null }
  /** Extra classes for spacing at the call site (e.g. "ml-2" when it follows inline text). */
  className?: string
}

/**
 * Marks a line item that was returned with a replacement requested — i.e. it has a
 * `return_date` and `wants_replacement`. Such items skip the Returns queue and re-enter
 * Purchasing without re-approval (migration 012), so this tag explains why an already
 * received item is back in an active state. Renders nothing when not applicable.
 */
export function ReplacementBadge({ item, className = '' }: ReplacementBadgeProps) {
  if (!(item.return_date && item.wants_replacement)) return null
  return (
    <span className={`inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 text-xs font-medium text-info ${className}`}>
      Replacement
    </span>
  )
}
