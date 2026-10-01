import { useState } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useProcurementApi } from '../data/db'
import { PERMS } from '../lib/constants'

interface ReDecidableItem {
  id: string
  item_description: string | null
  status: string
  po_id: string | null
  request: { id: string }
}

interface ReDecideActionsProps {
  item: ReDecidableItem
  /** Called after a successful action (e.g. silent list reload). */
  onDone: () => void | Promise<void>
}

/**
 * Post-decision change-of-mind actions for an APPROVED item (z8ygbxp4cg):
 * Undo approval (back to the For Approval queue), Hold, Decline, Cancel.
 *
 * Renders nothing unless the item is still re-decidable (status 'approved'
 * and not yet on a purchase order) and the caller holds the matching
 * permission — the same gates the RPCs enforce server-side:
 * decide_line_item requires approvals/act; cancel_line_item requires
 * approvals/act | purchasing/manage | admin/manage.
 */
export function ReDecideActions({ item, onDone }: ReDecideActionsProps) {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()
  const [busy, setBusy] = useState<string | null>(null)

  const canDecide = hasAppPermission(PERMS.approve)
  const canCancel = canDecide || hasAppPermission(PERMS.purchase) || hasAppPermission(PERMS.admin)

  if (item.status !== 'approved' || item.po_id != null) return null
  if (!canDecide && !canCancel) return null

  const label = item.item_description || 'this item'

  async function run(action: 'pending' | 'on_hold' | 'declined' | 'cancelled', confirm: string | null, message: string) {
    if (confirm && !window.confirm(confirm)) return
    setBusy(action)
    try {
      if (action === 'cancelled') {
        await api.cancelLineItem(item.id)
        await api.notifyStatusUpdate(item.request.id, [item.id], 'item_cancelled')
        api.fireNotification('item_cancelled', item.request.id, [item.id])
      } else {
        await api.decideLineItem(item.id, action)
        // Undo ('pending') intentionally fires no notification — the item
        // simply re-enters the For Approval queue.
        if (action === 'on_hold') api.fireNotification('item_on_hold', item.request.id, [item.id])
        if (action === 'declined') api.fireNotification('item_declined', item.request.id, [item.id])
      }
      showToast({ message, type: 'success' })
      await onDone()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Action failed', type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const btn = 'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50'

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => run('pending', `Undo the approval on "${label}"? It will go back to the For Approval queue.`, 'Approval undone — item back in For Approval')}
        className={`${btn} border-border text-foreground hover:bg-muted`}
      >
        {busy === 'pending' ? 'Undoing…' : 'Undo approval'}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => run('on_hold', null, 'Item placed on hold')}
        className={`${btn} border-warning/40 bg-warning/15 text-warning hover:bg-warning/25`}
      >
        {busy === 'on_hold' ? 'Holding…' : 'Hold'}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => run('declined', `Decline "${label}"? The requester will need to submit a new request if it is still needed.`, 'Item declined')}
        className={`${btn} border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25`}
      >
        {busy === 'declined' ? 'Declining…' : 'Decline'}
      </button>
      {canCancel && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('cancelled', `Cancel "${label}"? It will be marked cancelled and the requester will need to submit a new request if it is still needed.`, 'Item cancelled')}
          className={`${btn} border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25`}
        >
          {busy === 'cancelled' ? 'Cancelling…' : 'Cancel'}
        </button>
      )}
    </div>
  )
}
