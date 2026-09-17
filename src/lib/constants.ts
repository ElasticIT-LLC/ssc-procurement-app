export const LINE_ITEM_STATUS = ['pending','approved','declined','on_hold','ordered','received','returned','replacement_ordered','cancelled'] as const
export type LineItemStatus = typeof LINE_ITEM_STATUS[number]
export const REQUEST_STATUS = ['pending','on_hold','partially_approved','approved','declined','cancelled'] as const
export type RequestStatus = typeof REQUEST_STATUS[number]
export const RETURN_REASONS = ['poor_quality','didnt_need','broken','other'] as const
// semantic-token color per status (used by status badges in 1b–1d)
export const STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground', approved: 'bg-success/15 text-success',
  declined: 'bg-destructive/15 text-destructive', on_hold: 'bg-warning/15 text-warning',
  ordered: 'bg-info/15 text-info', received: 'bg-success/15 text-success',
  returned: 'bg-warning/15 text-warning', replacement_ordered: 'bg-info/15 text-info',
  cancelled: 'bg-destructive/10 text-destructive',
}
export const PERMS = {
  create: 'apps/procurement/requests/create', view: 'apps/procurement/requests/view',
  approve: 'apps/procurement/approvals/act', purchase: 'apps/procurement/purchasing/manage',
  returns: 'apps/procurement/returns/manage', admin: 'apps/procurement/admin/manage',
  formsView: 'apps/procurement/forms/view', formsSubmit: 'apps/procurement/forms/submit',
} as const

export const FULL_ACCESS = 'apps/procurement/*'

export function hasAppPermission(permissions: string[] | undefined, key: string, isAdmin = false): boolean {
  if (isAdmin) return true
  const perms = permissions ?? []
  if (perms.includes('*')) return true
  if (perms.includes(key)) return true
  if (perms.includes(FULL_ACCESS) && key.startsWith('apps/procurement/')) return true
  return false
}

// Render a date/timestamp without the UTC off-by-one shift. `new Date('YYYY-MM-DD')`
// parses date-only strings as UTC midnight, which renders a day early in timezones
// behind UTC. For date-only strings we parse the parts as LOCAL; full timestamps
// (with a 'T') are already zoned, so we pass them through to Date directly.
export function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return ''
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value)
  return d.toLocaleDateString('en-US', options ?? { month: '2-digit', day: '2-digit', year: 'numeric' })
}
