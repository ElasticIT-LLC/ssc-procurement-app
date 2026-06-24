export const LINE_ITEM_STATUS = ['pending','approved','declined','on_hold','ordered','received','returned','replacement_ordered'] as const
export type LineItemStatus = typeof LINE_ITEM_STATUS[number]
export const REQUEST_STATUS = ['pending','on_hold','partially_approved','approved','declined'] as const
export type RequestStatus = typeof REQUEST_STATUS[number]
export const RETURN_REASONS = ['poor_quality','didnt_need','broken','other'] as const
// semantic-token color per status (used by status badges in 1b–1d)
export const STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground', approved: 'bg-success/15 text-success',
  declined: 'bg-destructive/15 text-destructive', on_hold: 'bg-warning/15 text-warning',
  ordered: 'bg-info/15 text-info', received: 'bg-success/15 text-success',
  returned: 'bg-warning/15 text-warning', replacement_ordered: 'bg-info/15 text-info',
}
export const PERMS = {
  create: 'apps/procurement/requests/create', view: 'apps/procurement/requests/view',
  approve: 'apps/procurement/approvals/act', purchase: 'apps/procurement/purchasing/manage',
  returns: 'apps/procurement/returns/manage', admin: 'apps/procurement/admin/manage',
} as const
