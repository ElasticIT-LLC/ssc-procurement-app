import { useState, useEffect, useCallback } from 'react'
import { useToast, usePermissions } from '@elasticit-llc/app-bridge'
import { useProcurementApi, Location, Department } from '../data/db'
import { PERMS, LINE_ITEM_STATUS } from '../lib/constants'
import { FIELD_OPTIONS, OPERATOR_OPTIONS, DEFAULT_RULES, type FormatRule, type FormatField, type FormatOperator } from '../formatting/rules'
import { TONE_OPTIONS } from '../formatting/tones'

// ─── Collapsible card wrapper ───────────────────────────────────────────────
// A bordered card whose header (title + optional right-side text) toggles the
// body open/closed. Defaults to collapsed; click a header to expand.

interface CollapsibleCardProps {
  title: string
  right?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function CollapsibleCard({ title, right, defaultOpen = false, children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▸</span>
          <span className="text-base font-semibold text-foreground truncate">{title}</span>
        </span>
        {right && <span className="shrink-0 text-xs text-muted-foreground">{right}</span>}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ─── Inline-edit row for a single location or department ────────────────────

interface EditableRowProps {
  id: string
  name: string
  isActive: boolean
  onRename: (id: string, name: string) => Promise<void>
  onToggle: (id: string, isActive: boolean) => Promise<void>
}

function EditableRow({ id, name, isActive, onRename, onToggle }: EditableRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)

  async function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) { setEditing(false); setDraft(name); return }
    setBusy(true)
    try {
      await onRename(id, trimmed)
    } finally {
      setBusy(false)
      setEditing(false)
    }
  }

  async function handleToggle() {
    setBusy(true)
    try {
      await onToggle(id, !isActive)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 ${isActive ? '' : 'opacity-60'}`}>
      {/* Name / edit */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setDraft(name) } }}
            className="w-full rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <p className="text-sm font-medium text-foreground truncate">{name}</p>
        )}
      </div>

      {/* Status badge */}
      <span
        className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${isActive ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}
      >
        {isActive ? 'Active' : 'Inactive'}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setEditing(false); setDraft(name) }}
              className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleToggle}
              className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${isActive ? 'bg-destructive/15 text-destructive hover:bg-destructive/25' : 'bg-success/15 text-success hover:bg-success/25'}`}
            >
              {busy ? '…' : isActive ? 'Deactivate' : 'Activate'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Section (Locations or Departments) ─────────────────────────────────────

interface AdminSectionProps {
  title: string
  items: (Location | Department)[]
  onAdd: (name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onToggle: (id: string, isActive: boolean) => Promise<void>
}

function AdminSection({ title, items, onAdd, onRename, onToggle }: AdminSectionProps) {
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleAdd() {
    const trimmed = newName.trim()
    if (!trimmed) return
    setAdding(true)
    try {
      await onAdd(trimmed)
      setNewName('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <CollapsibleCard title={title} right={`${items.length} total`}>
      <div className="grid gap-3">
      {/* Add form */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder={`New ${title.toLowerCase().replace(/s$/, '')} name…`}
          className="flex-1 rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          disabled={adding || !newName.trim()}
          onClick={handleAdd}
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {/* List (all — active + inactive) */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {title.toLowerCase()} yet.</p>
      ) : (
        <div className="grid gap-2">
          {items.map(item => (
            <EditableRow
              key={item.id}
              id={item.id}
              name={item.name}
              isActive={item.is_active}
              onRename={onRename}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
      </div>
    </CollapsibleCard>
  )
}

// ─── Conditional Formatting rule editor ──────────────────────────────────────

function fieldType(field: FormatField): 'status' | 'date' | 'number' | 'text' {
  return FIELD_OPTIONS.find(f => f.field === field)?.type ?? 'text'
}

const HIDE_VALUE_OPERATORS: FormatOperator[] = ['is_overdue', 'is_empty', 'is_not_empty']

interface FormattingRuleRowProps {
  rule: FormatRule
  index: number
  count: number
  onChange: (index: number, rule: FormatRule) => void
  onMove: (index: number, direction: -1 | 1) => void
  onDelete: (index: number) => void
}

function FormattingRuleRow({ rule, index, count, onChange, onMove, onDelete }: FormattingRuleRowProps) {
  const type = fieldType(rule.field)
  const operators = OPERATOR_OPTIONS[type]
  const showValue = !HIDE_VALUE_OPERATORS.includes(rule.operator)

  function handleFieldChange(field: FormatField) {
    const nextType = fieldType(field)
    const nextOperators = OPERATOR_OPTIONS[nextType]
    const operator = nextOperators.some(o => o.op === rule.operator) ? rule.operator : (nextOperators[0]?.op ?? 'equals')
    onChange(index, { ...rule, field, operator, value: '' })
  }

  function handleOperatorChange(operator: FormatOperator) {
    onChange(index, { ...rule, operator, value: HIDE_VALUE_OPERATORS.includes(operator) ? null : rule.value })
  }

  return (
    <div className={`grid gap-2 rounded-md border border-border bg-card px-3 py-2.5 ${rule.enabled ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={e => onChange(index, { ...rule, enabled: e.target.checked })}
          className="h-4 w-4 shrink-0 accent-primary"
          aria-label="Enabled"
        />

        <input
          type="text"
          value={rule.label ?? ''}
          onChange={e => onChange(index, { ...rule, label: e.target.value })}
          placeholder="Label (optional)"
          className="w-36 rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <select
          value={rule.field}
          onChange={e => handleFieldChange(e.target.value as FormatField)}
          className="rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {FIELD_OPTIONS.map(f => (
            <option key={f.field} value={f.field}>{f.label}</option>
          ))}
        </select>

        <select
          value={rule.operator}
          onChange={e => handleOperatorChange(e.target.value as FormatOperator)}
          className="rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {operators.map(o => (
            <option key={o.op} value={o.op}>{o.label}</option>
          ))}
        </select>

        {showValue && type === 'status' && (
          <select
            value={rule.value ?? ''}
            onChange={e => onChange(index, { ...rule, value: e.target.value })}
            className="rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select…</option>
            {LINE_ITEM_STATUS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {showValue && type === 'date' && (
          <input
            type="date"
            value={rule.value ?? ''}
            onChange={e => onChange(index, { ...rule, value: e.target.value })}
            className="rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}

        {showValue && type === 'number' && (
          <input
            type="number"
            value={rule.value ?? ''}
            onChange={e => onChange(index, { ...rule, value: e.target.value })}
            className="w-24 rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}

        {showValue && type === 'text' && (
          <input
            type="text"
            value={rule.value ?? ''}
            onChange={e => onChange(index, { ...rule, value: e.target.value })}
            placeholder="Value"
            className="rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}

        <select
          value={rule.tone}
          onChange={e => onChange(index, { ...rule, tone: e.target.value as FormatRule['tone'] })}
          className="rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {TONE_OPTIONS.map(t => (
            <option key={t.tone} value={t.tone}>{t.label}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
            className="inline-flex items-center rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            onClick={() => onMove(index, 1)}
            className="inline-flex items-center rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onDelete(index)}
            className="inline-flex items-center rounded-md bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/25"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function FormattingRulesCard() {
  const api = useProcurementApi()
  const { showToast } = useToast()

  const [rules, setRules] = useState<FormatRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getFormattingRules()
      .then(r => { if (!cancelled) setRules(r) })
      .catch(() => { if (!cancelled) setRules(DEFAULT_RULES) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function handleRuleChange(index: number, next: FormatRule) {
    setRules(prev => prev.map((r, i) => (i === index ? next : r)))
  }

  function handleMove(index: number, direction: -1 | 1) {
    setRules(prev => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const current = prev[index]
      const swapped = prev[target]
      if (!current || !swapped) return prev
      const next = [...prev]
      next[index] = swapped
      next[target] = current
      return next
    })
  }

  function handleDelete(index: number) {
    setRules(prev => prev.filter((_, i) => i !== index))
  }

  function handleAdd() {
    setRules(prev => [...prev, { id: crypto.randomUUID(), field: 'status', operator: 'equals', value: '', tone: 'neutral', enabled: true }])
  }

  function handleReset() {
    setRules(DEFAULT_RULES.map(r => ({ ...r })))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api.setFormattingRules(rules)
      showToast({ message: 'Formatting rules saved', type: 'success' })
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to save formatting rules', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CollapsibleCard title="Conditional Formatting" right={`${rules.length} rule${rules.length === 1 ? '' : 's'}`}>
      <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Rules are evaluated top to bottom — the first enabled match sets the row's tint. Applies across Records, Requests, Approvals, Purchasing, and Returns.
      </p>

      {loading ? (
        <div className="py-4 text-center text-muted-foreground text-sm">Loading…</div>
      ) : (
        <>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No formatting rules yet.</p>
          ) : (
            <div className="grid gap-2">
              {rules.map((rule, index) => (
                <FormattingRuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  count={rules.length}
                  onChange={handleRuleChange}
                  onMove={handleMove}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAdd}
              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Add rule
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="ml-auto inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
      </div>
    </CollapsibleCard>
  )
}

// ─── AdminPage ───────────────────────────────────────────────────────────────

export function AdminPage() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasPermission } = usePermissions()

  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Admin shows ALL rows (active + inactive) so deactivated items remain visible
  // and can be re-activated. (The active-only helpers are for the request dropdowns.)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [locs, depts] = await Promise.all([
        api.listAllLocations(),
        api.listAllDepartments(),
      ])
      setLocations(locs)
      setDepartments(depts)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Locations
  async function handleAddLocation(name: string) {
    try {
      await api.createLocation(name)
      showToast({ message: 'Location added', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to add location', type: 'error' })
    }
  }

  async function handleRenameLocation(id: string, name: string) {
    try {
      await api.updateLocation(id, { name })
      showToast({ message: 'Location renamed', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to rename location', type: 'error' })
    }
  }

  async function handleToggleLocation(id: string, isActive: boolean) {
    try {
      await api.updateLocation(id, { is_active: isActive })
      showToast({ message: isActive ? 'Location activated' : 'Location deactivated', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to update location', type: 'error' })
    }
  }

  // Departments
  async function handleAddDepartment(name: string) {
    try {
      await api.createDepartment(name)
      showToast({ message: 'Department added', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to add department', type: 'error' })
    }
  }

  async function handleRenameDepartment(id: string, name: string) {
    try {
      await api.updateDepartment(id, { name })
      showToast({ message: 'Department renamed', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to rename department', type: 'error' })
    }
  }

  async function handleToggleDepartment(id: string, isActive: boolean) {
    try {
      await api.updateDepartment(id, { is_active: isActive })
      showToast({ message: isActive ? 'Department activated' : 'Department deactivated', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to update department', type: 'error' })
    }
  }

  if (!hasPermission(PERMS.admin)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  return (
    <div className="grid gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Admin</h1>
        <p className="text-muted-foreground text-sm">
          Manage reference data for the procurement app. User roles are managed in the portal's{' '}
          <strong className="text-foreground">Admin → Roles</strong> — RBAC is shell-managed and is not configured here.
        </p>
      </div>

      {loading && (
        <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
      )}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="grid gap-4">
          <AdminSection
            title="Locations"
            items={locations}
            onAdd={handleAddLocation}
            onRename={handleRenameLocation}
            onToggle={handleToggleLocation}
          />

          <AdminSection
            title="Departments"
            items={departments}
            onAdd={handleAddDepartment}
            onRename={handleRenameDepartment}
            onToggle={handleToggleDepartment}
          />

          <FormattingRulesCard />
        </div>
      )}
    </div>
  )
}

export default AdminPage
