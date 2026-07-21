import { useState, useEffect } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, Location, Department } from '../data/db'
import { LineItemFormRow, LineItemDraft, LineItemDraftErrors } from './LineItemFormRow'
import { useShipToWorkers } from './useShipToWorkers'

interface NewRequestFormProps {
  onCancel: () => void
  onSuccess: () => void
}

function emptyItem(): LineItemDraft {
  return {
    ship_to_name: '',
    location_id: null,
    location_other: false,
    custom_location: '',
    department_id: null,
    department_other: false,
    custom_department: '',
    item_url: '',
    item_description: '',
    memo: '',
    quantity: 1,
    substitution_ok: false,
    date_needed: '',
  }
}

function validateItem(item: LineItemDraft): LineItemDraftErrors {
  const errs: LineItemDraftErrors = {}
  if (!item.item_description.trim()) errs.item_description = 'Item name is required'
  if (item.quantity < 1) errs.quantity = 'Quantity must be at least 1'
  if (!item.memo.trim()) errs.memo = 'Memo is required'
  if (!item.date_needed) errs.date_needed = 'Date needed is required'
  const hasLocation = item.location_id !== null || item.custom_location.trim().length > 0
  if (!hasLocation) errs.location = 'A location or custom location is required'
  const hasDept = item.department_id !== null || item.custom_department.trim().length > 0
  if (!hasDept) errs.department = 'A department or custom department is required'
  return errs
}

function hasErrors(errs: LineItemDraftErrors): boolean {
  return Object.keys(errs).length > 0
}

export function NewRequestForm({ onCancel, onSuccess }: NewRequestFormProps) {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { workers, loading: workersLoading, refresh: refreshWorkers } = useShipToWorkers()

  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItemDraft[]>([emptyItem()])
  const [itemErrors, setItemErrors] = useState<LineItemDraftErrors[]>([{}])
  const [submitting, setSubmitting] = useState(false)
  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.listLocations(), api.listDepartments()])
      .then(([locs, depts]) => { setLocations(locs); setDepartments(depts) })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load options'))
  }, [])

  function updateItem(index: number, updated: LineItemDraft) {
    setItems((prev) => prev.map((it, i) => (i === index ? updated : it)))
    // Clear errors on change
    setItemErrors((prev) => prev.map((e, i) => (i === index ? {} : e)))
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()])
    setItemErrors((prev) => [...prev, {}])
  }

  function removeItem(index: number) {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, i) => i !== index))
    setItemErrors((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate all items
    const allErrors = items.map(validateItem)
    setItemErrors(allErrors)
    if (allErrors.some(hasErrors)) return

    setSubmitting(true)
    try {
      const lineItems = items.map((item) => ({
        ship_to_name: item.ship_to_name || null,
        location_id: item.location_id || null,
        custom_location: item.custom_location || null,
        department_id: item.department_id || null,
        custom_department: item.custom_department || null,
        item_url: item.item_url || null,
        item_description: item.item_description,
        memo: item.memo,
        quantity: item.quantity,
        substitution_ok: item.substitution_ok,
        date_needed: item.date_needed,
      }))
      const requestId = await api.submitRequest(notes, lineItems)
      showToast({ message: 'Request submitted successfully', type: 'success' })
      // Fire notifications before navigating away — onSuccess() unmounts this component
      // and cancels any in-flight fetches.
      api.notifyStatusUpdate(requestId, [], 'requester_confirmation')
      // Fire-and-forget capture + approver notification; report the outcome.
      api.captureAndNotify(requestId).then((res) => {
        if (!res) return
        const captured = res.items.filter((i) => i.captured).length
        showToast({ message: `Captured ${captured}/${res.items.length} product images, notified ${res.recipients} approver(s)`, type: captured === res.items.length ? 'success' : 'info' })
      }).catch(() => {})
      onSuccess()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to submit request', type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      {/* Line items */}
      <div className="grid gap-4">
        {items.map((item, index) => (
          <LineItemFormRow
            key={index}
            index={index}
            value={item}
            onChange={(updated) => updateItem(index, updated)}
            onRemove={() => removeItem(index)}
            disableRemove={items.length <= 1}
            locations={locations}
            departments={departments}
            errors={itemErrors[index] ?? {}}
            workers={workers}
            workersLoading={workersLoading}
            onRefreshWorkers={refreshWorkers}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
      >
        + Add Item
      </button>

      <hr className="border-border" />

      {/* Notes */}
      <div className="grid gap-1.5">
        <label className="text-sm font-medium text-foreground">Notes (optional)</label>
        <textarea
          rows={3}
          placeholder="Any additional notes for this request..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit Request'}
        </button>
      </div>
    </form>
  )
}
