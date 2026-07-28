import { useState, useEffect } from 'react'
import { useShellContext, useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, Location, Department } from '../data/db'
import { ShipToCombobox } from '../requester/ShipToCombobox'
import { useShipToWorkers } from '../requester/useShipToWorkers'

interface AnonLineItemDraft {
  ship_to_name: string
  location_id: string | null
  location_other: boolean
  custom_location: string
  department_id: string | null
  department_other: boolean
  custom_department: string
  item_url: string
  item_description: string
  memo: string
  quantity: number
  substitution_ok: boolean
  date_needed: string
}

interface LineItemDraftErrors {
  item_description?: string
  quantity?: string
  location?: string
  department?: string
  memo?: string
  date_needed?: string
}

function emptyItem(): AnonLineItemDraft {
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

function validateItem(item: AnonLineItemDraft): LineItemDraftErrors {
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

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function PublicRequestFormPage() {
  const ctx = useShellContext()
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { workers, loading: workersLoading, refresh: refreshWorkers } = useShipToWorkers()

  // Public form requires authentication. Redirect to the shell login page and
  // store the current path so the shell returns the user here after SSO.
  useEffect(() => {
    if (!ctx.user) {
      const returnPath = window.location.pathname + window.location.search
      try { sessionStorage.setItem('shell:returnTo', returnPath) } catch { /* ignore */ }
      window.location.href = '/login'
    }
  }, [ctx.user])

  // Show nothing while the redirect is in progress so unauthenticated users don't
  // see a flash of form fields.
  if (!ctx.user) {
    return (
      <div className="max-w-lg mx-auto rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-muted-foreground">Redirecting to sign in…</p>
      </div>
    )
  }

  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<AnonLineItemDraft[]>([emptyItem()])
  const [itemErrors, setItemErrors] = useState<LineItemDraftErrors[]>([{}])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.listLocations(), api.listDepartments()])
      .then(([locs, depts]) => { setLocations(locs); setDepartments(depts) })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load options'))
  }, [])

  function updateItem(index: number, updated: AnonLineItemDraft) {
    setItems((prev) => prev.map((it, i) => (i === index ? updated : it)))
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
      const id = await api.submitRequest(notes, lineItems)
      setRequestId(id)
      setSubmitted(true)
      showToast({ message: 'Request submitted successfully', type: 'success' })
      await api.notifyStatusUpdate(id, [], 'requester_confirmation')
      const res = await api.captureAndNotify(id)
      if (res) {
        const captured = res.items.filter((i) => i.captured).length
        showToast({ message: `Captured ${captured}/${res.items.length} product images, notified ${res.recipients} approver(s)`, type: captured === res.items.length ? 'success' : 'info' })
      }
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to submit request', type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-xl font-semibold text-foreground">Request Submitted</h2>
        <p className="text-muted-foreground mt-2">
          Your purchase request has been submitted successfully. You will receive a confirmation email shortly.
        </p>
        {requestId && (
          <p className="text-xs text-muted-foreground mt-4">Reference: {requestId}</p>
        )}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground">Purchase Request</h1>
      <p className="text-sm text-muted-foreground mt-1">Submit a new purchase request.</p>

      <form onSubmit={handleSubmit} className="grid gap-6 mt-6">

        {/* Line items */}
        <div className="grid gap-4">
          {items.map((item, index) => (
            <div key={index} className="rounded-lg border border-border bg-card p-4 grid gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Item #{index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={items.length <= 1}
                  className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`Remove item ${index + 1}`}
                >
                  Remove
                </button>
              </div>

              {/* Ship To Name */}
              <Field label="Ship To Name">
                <ShipToCombobox
                  value={item.ship_to_name}
                  onChange={(v) => updateItem(index, { ...item, ship_to_name: v })}
                  workers={workers}
                  loading={workersLoading}
                  onRefresh={refreshWorkers}
                />
              </Field>

              {/* Location */}
              <Field label="Location" error={itemErrors[index]?.location}>
                <select
                  value={item.location_other ? '__other__' : (item.location_id ?? '')}
                  onChange={(e) => {
                    if (e.target.value === '__other__') {
                      updateItem(index, { ...item, location_id: null, location_other: true, custom_location: '' })
                    } else {
                      updateItem(index, { ...item, location_id: e.target.value, location_other: false, custom_location: '' })
                    }
                  }}
                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="" disabled>Select a location</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                  <option value="__other__">Other</option>
                </select>
                {item.location_other && (
                  <input
                    type="text"
                    placeholder="Enter custom location"
                    value={item.custom_location}
                    onChange={(e) => updateItem(index, { ...item, custom_location: e.target.value })}
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                )}
              </Field>

              {/* Department */}
              <Field label="Department" error={itemErrors[index]?.department}>
                <select
                  value={item.department_other ? '__other__' : (item.department_id ?? '')}
                  onChange={(e) => {
                    if (e.target.value === '__other__') {
                      updateItem(index, { ...item, department_id: null, department_other: true, custom_department: '' })
                    } else {
                      updateItem(index, { ...item, department_id: e.target.value, department_other: false, custom_department: '' })
                    }
                  }}
                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="" disabled>Select a department</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                  <option value="__other__">Other</option>
                </select>
                {item.department_other && (
                  <input
                    type="text"
                    placeholder="Enter custom department"
                    value={item.custom_department}
                    onChange={(e) => updateItem(index, { ...item, custom_department: e.target.value })}
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                )}
              </Field>

              {/* Item URL */}
              <Field label="Item URL (optional)">
                <input
                  type="url"
                  placeholder="https://..."
                  value={item.item_url}
                  onChange={(e) => updateItem(index, { ...item, item_url: e.target.value })}
                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </Field>

              {/* Quantity + Substitution OK */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Quantity" error={itemErrors[index]?.quantity}>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => updateItem(index, { ...item, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </Field>
                <div className="flex items-end gap-2 pb-2">
                  <input
                    type="checkbox"
                    id={`subst-${index}`}
                    checked={item.substitution_ok}
                    onChange={(e) => updateItem(index, { ...item, substitution_ok: e.target.checked })}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <label htmlFor={`subst-${index}`} className="text-sm text-foreground">Substitution OK</label>
                </div>
              </div>

              {/* Item Name */}
              <Field label="Item Name" error={itemErrors[index]?.item_description}>
                <input
                  type="text"
                  value={item.item_description}
                  onChange={(e) => updateItem(index, { ...item, item_description: e.target.value })}
                  placeholder="e.g. Dell 27&quot; Monitor"
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </Field>

              {/* Memo */}
              <Field label="Memo (reason for item)" error={itemErrors[index]?.memo}>
                <textarea
                  rows={2}
                  value={item.memo}
                  onChange={(e) => updateItem(index, { ...item, memo: e.target.value })}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </Field>

              {/* Date Needed */}
              <Field label="Date Needed" error={itemErrors[index]?.date_needed}>
                <input
                  type="date"
                  value={item.date_needed}
                  onChange={(e) => updateItem(index, { ...item, date_needed: e.target.value })}
                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </Field>
            </div>
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
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Submitting&hellip;' : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default PublicRequestFormPage
