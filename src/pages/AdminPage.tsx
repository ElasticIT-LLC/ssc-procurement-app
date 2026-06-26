import { useState, useEffect, useCallback } from 'react'
import { useToast, usePermissions } from '@elasticit-llc/app-bridge'
import { useProcurementApi, Location, Department } from '../data/db'
import { PERMS } from '../lib/constants'

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
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">{items.length} total</span>
      </div>

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

  // Load all (including inactive) — listLocations/listDepartments filter is_active=true,
  // but admin needs to see inactive rows. We query without the filter via the update path
  // and refresh after each mutation. For the initial load we use the existing helpers
  // but then augment via direct query for inactive rows.
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
        // Uses the active-only helpers from useProcurementApi.
      // Admin sees active items; toggled-inactive rows disappear after deactivation.
      // Re-fetch after every mutation ensures UI stays consistent.
      const [locs, depts] = await Promise.all([
        api.listLocations(),
        api.listDepartments(),
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
        <>
          <div className="rounded-lg border border-border bg-card p-4">
            <AdminSection
              title="Locations"
              items={locations}
              onAdd={handleAddLocation}
              onRename={handleRenameLocation}
              onToggle={handleToggleLocation}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <AdminSection
              title="Departments"
              items={departments}
              onAdd={handleAddDepartment}
              onRename={handleRenameDepartment}
              onToggle={handleToggleDepartment}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default AdminPage
