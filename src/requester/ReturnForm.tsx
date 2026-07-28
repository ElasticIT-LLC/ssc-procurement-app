import { useState } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, LineItemRow } from '../data/db'
import { RETURN_REASONS } from '../lib/constants'

interface ReturnFormProps {
  item: LineItemRow
  onDone: () => void
}

export function ReturnForm({ item, onDone }: ReturnFormProps) {
  const api = useProcurementApi()
  const { showToast } = useToast()

  const [returnQty, setReturnQty] = useState(item.quantity)
  const [returnReason, setReturnReason] = useState<string>(RETURN_REASONS[0])
  const [hasPackaging, setHasPackaging] = useState(false)
  const [wantsReplacement, setWantsReplacement] = useState(false)
  const [returnNotes, setReturnNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ qty?: string; reason?: string }>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: { qty?: string; reason?: string } = {}
    if (returnQty < 1 || returnQty > item.quantity) errs.qty = `Quantity must be between 1 and ${item.quantity}`
    if (!RETURN_REASONS.includes(returnReason as typeof RETURN_REASONS[number])) errs.reason = 'Select a valid reason'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)
    try {
      await api.initiateReturn(item.id, {
        return_quantity: returnQty,
        return_reason: returnReason,
        has_packaging: hasPackaging,
        wants_replacement: wantsReplacement,
        return_notes: returnNotes || null,
      })
      const reqId = item.request_id
      if (reqId) await api.notifyStatusUpdate(reqId, [item.id], 'return_notification')
      api.fireNotification('return_initiated', reqId, [item.id])
      showToast({ message: 'Return initiated', type: 'success' })
      onDone()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to initiate return', type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const REASON_LABELS: Record<string, string> = {
    poor_quality: 'Poor quality',
    didnt_need: "Didn't need it",
    broken: 'Broken / damaged',
    other: 'Other',
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-md border border-border bg-muted p-4 grid gap-3">
      <p className="text-sm font-medium text-foreground">Initiate Return</p>

      {/* Return quantity */}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Return Quantity</label>
        <input
          type="number"
          min={1}
          max={item.quantity}
          value={returnQty}
          onChange={(e) => setReturnQty(parseInt(e.target.value, 10) || 1)}
          className="h-9 w-32 rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.qty && <p className="text-xs text-destructive">{errors.qty}</p>}
      </div>

      {/* Return reason */}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Reason</label>
        <select
          value={returnReason}
          onChange={(e) => setReturnReason(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {RETURN_REASONS.map((r) => (
            <option key={r} value={r}>{REASON_LABELS[r] ?? r}</option>
          ))}
        </select>
        {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
      </div>

      {/* Has packaging */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`pkg-${item.id}`}
          checked={hasPackaging}
          onChange={(e) => setHasPackaging(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        <label htmlFor={`pkg-${item.id}`} className="text-sm text-foreground">Original packaging available</label>
      </div>

      {/* Wants replacement */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`repl-${item.id}`}
          checked={wantsReplacement}
          onChange={(e) => setWantsReplacement(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        <label htmlFor={`repl-${item.id}`} className="text-sm text-foreground">Request replacement</label>
      </div>
      {wantsReplacement && (
        <p className="text-xs text-muted-foreground">
          Items for return with replacement will have to be reordered. This request will show up under the Purchasing tab.
        </p>
      )}

      {/* Return notes */}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Additional Notes (optional)</label>
        <textarea
          rows={2}
          value={returnNotes}
          onChange={(e) => setReturnNotes(e.target.value)}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={submitting}
          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-card disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit Return'}
        </button>
      </div>
    </form>
  )
}
