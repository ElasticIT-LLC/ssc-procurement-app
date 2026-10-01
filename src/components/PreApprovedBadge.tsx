interface PreApprovedBadgeProps {
  /** Any line-item shape; the badge shows only when the item came from the pre-approved catalog. */
  item: { pre_approved_item_id: string | null }
  /** Extra classes for spacing at the call site (e.g. "ml-2" when it follows inline text). */
  className?: string
}

/**
 * Marks a line item that was created by a pre-approved catalog re-order
 * (`order_pre_approved_item` sets line_items.pre_approved_item_id) as opposed
 * to a normal new request. Renders nothing for regular request items.
 */
export function PreApprovedBadge({ item, className = '' }: PreApprovedBadgeProps) {
  if (!item.pre_approved_item_id) return null
  return (
    <span className={`inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary ${className}`}>
      Pre-approved
    </span>
  )
}
