import { useState } from 'react'
import { useAppPermissions } from '../lib/useAppPermissions'
import { PERMS } from '../lib/constants'
import { ReadyForPurchasing } from '../purchasing/ReadyForPurchasing'
import { OpenOrders } from '../purchasing/OpenOrders'
import { ClosedOrders } from '../purchasing/ClosedOrders'
import { FavoritesTab } from '../purchasing/FavoritesTab'

type Tab = 'ready' | 'open' | 'closed' | 'favorites'
const TABS: { key: Tab; label: string }[] = [
  { key: 'ready', label: 'Ready for Purchasing' },
  { key: 'open', label: 'Open Orders' },
  { key: 'closed', label: 'Closed Orders' },
]

export function PurchasingPage() {
  const { hasAppPermission } = useAppPermissions()
  const [tab, setTab] = useState<Tab>('ready')

if (!hasAppPermission(PERMS.purchase) && !hasAppPermission(PERMS.admin)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  // The Favorite Items tab manages the shared reorder catalog — visible to
  // everyone who can view this page (purchasers and admins). Approvers reach
  // the same tab from the Approvals page. Adding is allowed for all three
  // roles (RLS migration 032); removing stays admin-only.
  const tabs: { key: Tab; label: string }[] = [...TABS, { key: 'favorites', label: 'Favorite Items' }]

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Purchasing</h1>
        <p className="text-muted-foreground text-sm">Order approved items and track purchase orders.</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'ready' && <ReadyForPurchasing />}
      {tab === 'open' && <OpenOrders />}
      {tab === 'closed' && <ClosedOrders />}
      {tab === 'favorites' && <FavoritesTab />}
    </div>
  )
}

export default PurchasingPage
