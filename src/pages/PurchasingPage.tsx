import { useState } from 'react'
import { usePermissions } from '@elasticit-llc/app-bridge'
import { PERMS } from '../lib/constants'
import { ReadyForPurchasing } from '../purchasing/ReadyForPurchasing'
import { OpenOrders } from '../purchasing/OpenOrders'
import { ClosedOrders } from '../purchasing/ClosedOrders'

type Tab = 'ready' | 'open' | 'closed'
const TABS: { key: Tab; label: string }[] = [
  { key: 'ready', label: 'Ready for Purchasing' },
  { key: 'open', label: 'Open Orders' },
  { key: 'closed', label: 'Closed Orders' },
]

export function PurchasingPage() {
  const { hasPermission } = usePermissions()
  const [tab, setTab] = useState<Tab>('ready')

  if (!hasPermission(PERMS.purchase)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Purchasing</h1>
        <p className="text-muted-foreground text-sm">Order approved items and track purchase orders.</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
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
    </div>
  )
}

export default PurchasingPage
