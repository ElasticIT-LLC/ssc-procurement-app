import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useProcurementApi, PreApprovedItem, Location, Department } from '../data/db'
import { PERMS, formatDate } from '../lib/constants'
import { Modal } from '../components/Modal'
import { DateInput } from '../components/DateInput'
import { prefillFromCatalog, draftToRpcPayload, OTHER, type PreApprovedOrderDraft } from './preApproved'

const inputClass = 'w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring'

export function PreApprovedTab() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()

  const isAdmin = hasAppPermission(PERMS.admin)
  const canOrder = hasAppPermission(PERMS.purchase) || hasAppPermission(PERMS.approve) || isAdmin

  const [items, setItems] = useState<PreApprovedItem[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orderFor, setOrderFor] = useState<PreApprovedItem | null>(null)
  const [form, setForm] = useState<PreApprovedOrderDraft | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [catalog, locs, depts] = await Promise.all([
        api.listPreApprovedItems(),
        api.listLocations(),
        api.listDepartments(),
      ])
      setItems(catalog)
      setLocations(locs)
      setDepartments(depts)
      setNames(await api.resolveUserNames(catalog.map((i) => i.created_by).filter((x): x is string => !!x)))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load pre-approved items')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  function locName(item: PreApprovedItem): string {
    const loc = item.location_id ? locations.find((l) => l.id === item.location_id) : undefined
    return loc?.name || item.custom_location || '—'
  }

  function deptName(item: PreApprovedItem): string {
    const dept = item.department_id ? departments.find((d) => d.id === item.department_id) : undefined
    return dept?.name || item.custom_department || '—'
  }

  function openOrderDialog(item: PreApprovedItem) {
    setOrderFor(item)
    setForm(prefillFromCatalog(item))
  }

  function updateForm(patch: Partial<PreApprovedOrderDraft>) {
    setForm((f) => (f ? { ...f, ...patch } : f))
  }

  const locIsOther = form?.location_id === OTHER
  const deptIsOther = form?.department_id === OTHER
  const canSubmit = !!form
    && form.name.trim() !== ''
    && (form.location_id === OTHER ? form.custom_location.trim() !== '' : form.location_id !== '')
    && (form.department_id === OTHER ? form.custom_department.trim() !== '' : form.department_id !== '')

  async function handleOrderSubmit() {
    if (!orderFor || !form) return
    setSubmitting(true)
    try {
      await api.orderPreApprovedItem(orderFor.id, draftToRpcPayload(form))
      showToast({ message: 'Order created — see Ready for Purchasing', type: 'success' })
      setOrderFor(null)
      setForm(null)
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to create order', type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(item: PreApprovedItem) {
    if (!window.confirm(`Remove "${item.name}" from the pre-approved catalog?`)) return
    setRemovingId(item.id)
    try {
      await api.deletePreApprovedItem(item.id)
      showToast({ message: 'Removed from catalog', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to remove item', type: 'error' })
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="grid gap-4">
      {loading && <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No pre-approved items yet. Use "Pre-approve" on a pending item to add one.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2 font-medium">Added by</th>
                <th className="px-3 py-2 font-medium">Added</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{item.name}</span>
                    {item.item_url && (
                      <a href={item.item_url} target="_blank" rel="noreferrer" className="block text-xs text-primary underline break-all">
                        {item.item_url}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{item.quantity}</td>
                  <td className="px-3 py-2 text-muted-foreground">{locName(item)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{deptName(item)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{item.created_by ? names[item.created_by] || 'Unknown' : '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(item.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      {canOrder && (
                        <button
                          type="button"
                          onClick={() => openOrderDialog(item)}
                          className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          New Purchase
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          disabled={removingId === item.id}
                          onClick={() => handleRemove(item)}
                          className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {orderFor && form && (
        <Modal title={`New Purchase — ${orderFor.name}`} onClose={() => { setOrderFor(null); setForm(null) }}>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Item name</label>
              <input type="text" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} className={inputClass} />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Item URL</label>
              <input type="text" value={form.item_url} onChange={(e) => updateForm({ item_url: e.target.value })} placeholder="https://…" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Quantity</label>
                <input type="number" min={1} step={1} value={form.quantity} onChange={(e) => updateForm({ quantity: Number(e.target.value) })} className={inputClass} />
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Date needed</label>
                <DateInput value={form.date_needed} onChange={(v) => updateForm({ date_needed: v })} className={inputClass} />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Ship-to name</label>
              <input type="text" value={form.ship_to_name} onChange={(e) => updateForm({ ship_to_name: e.target.value })} placeholder="Optional" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Location</label>
                <select value={form.location_id} onChange={(e) => updateForm({ location_id: e.target.value })} className={inputClass}>
                  <option value="">— Select location —</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                  <option value={OTHER}>Other</option>
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Department</label>
                <select value={form.department_id} onChange={(e) => updateForm({ department_id: e.target.value })} className={inputClass}>
                  <option value="">— Select department —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value={OTHER}>Other</option>
                </select>
              </div>
            </div>
            {locIsOther && (
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Custom location</label>
                <input type="text" value={form.custom_location} onChange={(e) => updateForm({ custom_location: e.target.value })} placeholder="Enter location" className={inputClass} />
              </div>
            )}
            {deptIsOther && (
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Custom department</label>
                <input type="text" value={form.custom_department} onChange={(e) => updateForm({ custom_department: e.target.value })} placeholder="Enter department" className={inputClass} />
              </div>
            )}
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Memo</label>
              <textarea rows={2} value={form.memo} onChange={(e) => updateForm({ memo: e.target.value })} placeholder="Optional…" className={`${inputClass} resize-none`} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={form.substitution_ok} onChange={(e) => updateForm({ substitution_ok: e.target.checked })} className="h-4 w-4 accent-primary" />
              Substitution OK
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canSubmit || submitting}
                onClick={handleOrderSubmit}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create Order'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => { setOrderFor(null); setForm(null) }}
                className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default PreApprovedTab
