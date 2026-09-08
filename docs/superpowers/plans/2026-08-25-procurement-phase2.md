# Procurement Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 features to the procurement app v0.18.0 on `for-qa`: Records archive (replaces Delete), admin-curated favorites catalog with form auto-suggest, approver-only "New request to approve" notifications, and font styles in conditional formatting.

**Architecture:** All changes stay in `msr-procurement-app` (repo at `C:\Users\jbugahon\Code\msr-procurement-app`, branch `for-qa`) plus its QA Supabase project `jkbqaxpfvqbeepwhunhl`. Two new DB migrations (028, 029), one edge-function redeploy (`procurement-capture-and-notify`), and React/Tailwind UI changes. No shell or ui-kit changes.

**Tech Stack:** TypeScript, React 19, Vite 8, Tailwind 4, Supabase (PostgREST + RPC + edge functions, Deno), vitest 4, xlsx/recharts (existing).

## Global Constraints

- Version: 0.17.0 → **0.18.0** in both `package.json` and `app.manifest.json` (Task 8 only).
- Branch `for-qa` uses plain (non-pre-release) versions for this app — established convention.
- Dates display as MM/DD/YYYY via `formatDate` from `src/lib/constants.ts`.
- Permission keys: `FULL_ACCESS = 'apps/procurement/*'`, `PERMS.admin = 'apps/procurement/admin/manage'`, `PERMS.approve = 'apps/procurement/approvals/act'` (from `src/lib/constants.ts`).
- RPC pattern: SECURITY DEFINER, gate with `public.check_user_permission(auth.uid(), '<key>')`, `SET search_path = app_procurement, public`, grants to `authenticated, service_role` (client-called RPCs follow migration 017's pattern).
- Tailwind classes must be literal strings (the @source scan requirement noted in `src/formatting/tones.ts`).
- After each UI task: `npm test` (vitest) must pass; `npm run build` typechecks at the end.
- QA Supabase project ID: `jkbqaxpfvqbeepwhunhl`. Migrations applied via the MCP `supabase_apply_migration` tool (snake_case name). Edge functions deployed via MCP `supabase_deploy_edge_function` with all 4 local files, entrypoint `index.ts`, `verify_jwt: false`.
- Do NOT touch production Supabase (`rhdsvbojqinwpfumdvnu`).
- Commit after every task. Push to `for-qa` only in Task 8.

## File Structure

| File | Responsibility |
|---|---|
| `migrations/028_archive_line_item.sql` | NEW — `line_items.archived_at` + `archive_line_item` RPC |
| `migrations/029_favorite_items.sql` | NEW — `favorite_items` catalog table + RLS |
| `app.manifest.json` | +2 migration entries, +`favorite_items` table entry (Tasks 1, 3), version bump (Task 8) |
| `src/data/db.ts` | `archived_at` on `LineItemRow`, archived filters, `archiveLineItem`, `FavoriteItem` + 3 favorites helpers |
| `src/records/RecordsPage.tsx` | Delete → Archive/Unarchive + "Show archived" toggle |
| `src/purchasing/FavoritesTab.tsx` | NEW — admin favorites manager (add/remove/list) |
| `src/pages/PurchasingPage.tsx` | +Favorites tab (admin-only) |
| `src/requester/ItemNameCombobox.tsx` | NEW — searchable favorites combobox + `filterFavorites` |
| `src/requester/ItemNameCombobox.test.ts` | NEW — `filterFavorites` unit tests |
| `src/requester/LineItemFormRow.tsx` | Item Name → ItemNameCombobox + helper text |
| `src/requester/NewRequestForm.tsx` | Load favorites once, pass to rows |
| `supabase/functions/procurement-capture-and-notify/index.ts` | Scope `request_submitted` recipients to approver permission holders |
| `src/formatting/rules.ts` | Font flags on `FormatRule`, `evalRowFormat` |
| `src/formatting/rules.test.ts` | NEW — `evalRowFormat` tests |
| `src/formatting/tones.ts` | `FONT_CLASS` map |
| `src/formatting/useFormattingRules.ts` | `toneClassFor` returns combined bg + font classes |
| `src/pages/AdminPage.tsx` | Font checkboxes in rule editor |

Notes:
- `PublicRequestFormPage.tsx` needs **no change**: its authenticated (private-link) branch already renders `NewRequestForm` → `LineItemFormRow`, so suggestions arrive there automatically. Anonymous visitors keep the plain input (RLS denies them catalog reads).
- The existing `delete_line_item` RPC stays in the DB (backwards-compatible); only its UI is removed.
- Workflow queues (`listLineItemsByStatus`: Approvals/Purchasing/Returns) are intentionally NOT filtered by `archived_at` — archiving is records-management, not a workflow state.

---

### Task 1: Migration 028 — archive column + RPC

**Files:**
- Create: `migrations/028_archive_line_item.sql`
- Modify: `app.manifest.json` (migrations array, after version 27 entry)

**Interfaces:**
- Produces: `app_procurement.line_items.archived_at timestamptz NULL`; RPC `app_procurement.archive_line_item(p_line_item_id uuid, p_archived boolean)` — sets/clears `archived_at`, gated to `apps/procurement/*` holders.

- [ ] **Step 1: Write the migration file**

`migrations/028_archive_line_item.sql`:

```sql
-- 028: Records archive (soft delete). archived_at = NULL means active.
-- Records management only: does NOT change item/request status or rollups.
-- Replaces the UI Delete button; the hard-delete RPC (delete_line_item) is
-- intentionally left in place for DB-level use.

ALTER TABLE app_procurement.line_items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION app_procurement.archive_line_item(
  p_line_item_id uuid,
  p_archived boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app_procurement, public AS $fn$
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/*') THEN
    RAISE EXCEPTION 'Only full-access admins can archive items';
  END IF;

  UPDATE app_procurement.line_items
     SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
         updated_at  = now()
   WHERE id = p_line_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.archive_line_item(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_procurement.archive_line_item(uuid, boolean) TO authenticated, service_role;
```

- [ ] **Step 2: Add manifest migration entry**

In `app.manifest.json`, in the `database.migrations` array, add after the version 27 entry:

```json
      { "version": 28, "description": "Records archive: line_items.archived_at + archive_line_item RPC (soft delete replaces UI delete)", "up": "migrations/028_archive_line_item.sql" }
```

- [ ] **Step 3: Apply to QA Supabase**

Use MCP `supabase_apply_migration` with `project_id: "jkbqaxpfvqbeepwhunhl"`, `name: "028_archive_line_item"`, `query:` = the full SQL above. Expected: success, no errors.

- [ ] **Step 4: Verify**

MCP `supabase_execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='app_procurement' AND table_name='line_items' AND column_name='archived_at';
SELECT proname, proargtypes::regtype[] FROM pg_proc WHERE proname='archive_line_item' AND pronamespace='app_procurement'::regnamespace;
```
Expected: one row `archived_at | timestamp with time zone`; one row `archive_line_item | {uuid, boolean}`.

- [ ] **Step 5: Commit**

```bash
git add migrations/028_archive_line_item.sql app.manifest.json
git commit -m "feat(archive): line_items.archived_at + archive_line_item RPC (migration 028)"
```

---

### Task 2: Archive in data layer + Records page

**Files:**
- Modify: `src/data/db.ts`
- Modify: `src/records/RecordsPage.tsx`

**Interfaces:**
- Consumes: Task 1's `archived_at` column + `archive_line_item` RPC.
- Produces: `LineItemRow.archived_at: string | null`; `api.listAllLineItemsDetailed(includeArchived?: boolean)`; `api.archiveLineItem(id: string, archived: boolean)`; Records page Archive/Unarchive + "Show archived" toggle.

- [ ] **Step 1: Update `src/data/db.ts`**

a) `RPCS` const (line 7): add `archiveItem: 'archive_line_item'` after `deleteItem: 'delete_line_item',`.

b) `LineItemRow` interface (line 10): add `archived_at: string | null` after `po_id: string | null`.

c) `listAllLineItemsDetailed` (line 143) — replace with:

```ts
  async function listAllLineItemsDetailed(includeArchived = false): Promise<LineItemDetailed[]> {
    let query = db().from(TABLES.lineItems)
      .select('*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at, status), locations!location_id(name), departments!department_id(name)')
      .order('created_at', { ascending: false })
    if (!includeArchived) query = query.is('archived_at', null)
    const rows = ok(await query) ?? []
    return (rows as unknown as (LineItemRow & {
      purchase_requests: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
      locations: { name: string } | null
      departments: { name: string } | null
    })[]).map(row => {
      const { purchase_requests, locations, departments, ...item } = row
      return { ...item, request: purchase_requests, location: locations, department: departments } as LineItemDetailed
    })
  }
```

d) `countLineItems` (line 158) — add `.is('archived_at', null)` before the options arg:

```ts
  async function countLineItems(): Promise<number> {
    const res = await db().from(TABLES.lineItems).select('*', { count: 'exact', head: true }).is('archived_at', null)
    if (res.error) throw new Error(res.error.message)
    return res.count ?? 0
  }
```

e) `listLineItemFacets` (line 170) — add `.is('archived_at', null)` to the select chain:

```ts
  async function listLineItemFacets(): Promise<{ status: string; location_id: string | null; custom_location: string | null }[]> {
    return (ok(await db().from(TABLES.lineItems).select('status, location_id, custom_location').is('archived_at', null)) ?? []) as { status: string; location_id: string | null; custom_location: string | null }[]
  }
```

f) New function after `deleteLineItem` (line 174):

```ts
  async function archiveLineItem(id: string, archived: boolean): Promise<void> { ok(await db().rpc(RPCS.archiveItem, { p_line_item_id: id, p_archived: archived })) }
```

g) Add `archiveLineItem` to the returned object (line 255, after `deleteLineItem`).

- [ ] **Step 2: Update `src/records/RecordsPage.tsx`**

a) Line 60: replace `const canDelete = hasAppPermission(FULL_ACCESS)` with:

```tsx
  const canArchive = hasAppPermission(FULL_ACCESS)
```

b) Add state (near the other useState lines, ~line 63-69):

```tsx
  const [showArchived, setShowArchived] = useState(false)
```

c) `load` callback (lines 71-85): call `api.listAllLineItemsDetailed(showArchived)` and change the dependency array to `[showArchived]`:

```tsx
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listAllLineItemsDetailed(showArchived)
      setItems(data)
      setDrafts(Object.fromEntries(data.map(i => [i.id, i.admin_comment ?? ''])))
      const map = await api.resolveUserNames(data.map((r) => r.commented_by).filter((x): x is string => !!x))
      setNames(map)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load records')
    } finally {
      setLoading(false)
    }
  }, [showArchived])
```

d) Replace `handleDelete` (lines 102-114) with:

```tsx
  async function handleArchive(item: LineItemDetailed) {
    const archiving = !item.archived_at
    const label = item.item_description ?? 'this item'
    if (!window.confirm(archiving ? `Archive "${label}"? It will be hidden from Records and the dashboard until unarchived.` : `Unarchive "${label}"?`)) return
    setBusyId(item.id)
    try {
      await api.archiveLineItem(item.id, archiving)
      showToast({ message: archiving ? 'Item archived' : 'Item unarchived', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to update item', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }
```

e) Line 126: `const showActionsColumn = canArchive || canReturn`

f) Header block (lines 132-145): wrap the Show archived toggle + Export CSV button:

```tsx
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground mb-1">Records</h1>
          <p className="text-muted-foreground text-sm">Every requested item, one row each.</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Show archived
          </label>
          <button
            type="button"
            onClick={() => exportCsv(items)}
            disabled={items.length === 0}
            className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>
```

g) Status cell (line 205): add the Archived badge:

```tsx
  <td className={cell}><span className="inline-flex flex-wrap items-center gap-1"><StatusBadge status={item.status} /><ReplacementBadge item={item} />{item.archived_at && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Archived</span>}</span></td>
```

h) Actions cell (lines 252-261): replace the Delete button block with:

```tsx
  {canArchive && (
    <button
      type="button"
      disabled={busyId === item.id}
      onClick={() => handleArchive(item)}
      className="inline-flex items-center rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
    >
      {item.archived_at ? 'Unarchive' : 'Archive'}
    </button>
  )}
```

- [ ] **Step 3: Typecheck + test**

Run: `npm run build` (workdir `C:\Users\jbugahon\Code\msr-procurement-app`)
Expected: build succeeds, tsc clean.
Run: `npm test`
Expected: all 33 existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/data/db.ts src/records/RecordsPage.tsx
git commit -m "feat(records): replace Delete with Archive toggle; hide archived from dashboard by default"
```

---

### Task 3: Migration 029 — favorite_items catalog

**Files:**
- Create: `migrations/029_favorite_items.sql`
- Modify: `app.manifest.json` (migrations array + tables array)

**Interfaces:**
- Produces: table `app_procurement.favorite_items(id uuid, name text, item_url text, created_by uuid, created_at timestamptz)`, unique on `lower(name)`; RLS: SELECT for all authenticated, writes only for `apps/procurement/admin/manage` holders.

- [ ] **Step 1: Write the migration file**

`migrations/029_favorite_items.sql`:

```sql
-- 029: Favorite items — admin-curated catalog of standard items, surfaced as
-- auto-suggestions in the request forms' Item Name field. Single shared list
-- (not per-user): admins add/remove; every authenticated form user gets
-- suggestions; anonymous public-form visitors get plain text (no RLS read).

CREATE TABLE IF NOT EXISTS app_procurement.favorite_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  item_url   text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_favorite_items_name UNIQUE (lower(name))
);

ALTER TABLE app_procurement.favorite_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS favorite_items_read_all ON app_procurement.favorite_items;
CREATE POLICY favorite_items_read_all ON app_procurement.favorite_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS favorite_items_admin_write ON app_procurement.favorite_items;
CREATE POLICY favorite_items_admin_write ON app_procurement.favorite_items
  FOR ALL TO authenticated
  USING (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'))
  WITH CHECK (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));
```

- [ ] **Step 2: Add manifest entries**

In `app.manifest.json`:
a) `database.migrations` — after the version 28 entry:

```json
      { "version": 29, "description": "Favorite items catalog (admin-curated, form auto-suggestions) + RLS", "up": "migrations/029_favorite_items.sql" }
```

b) `database.tables` — after the `purchase_orders` entry:

```json
      { "name": "favorite_items",    "rls": { "read": "authenticated", "write": "admin" } }
```

- [ ] **Step 3: Apply to QA Supabase**

MCP `supabase_apply_migration` with `project_id: "jkbqaxpfvqbeepwhunhl"`, `name: "029_favorite_items"`, `query:` = the full SQL above.

- [ ] **Step 4: Verify**

MCP `supabase_execute_sql`:
```sql
SELECT count(*) FROM app_procurement.favorite_items;
SELECT policyname, permissive, cmd FROM pg_policies WHERE tablename='favorite_items';
```
Expected: `count = 0`; two policies (`favorite_items_read_all` SELECT, `favorite_items_admin_write` ALL).

- [ ] **Step 5: Commit**

```bash
git add migrations/029_favorite_items.sql app.manifest.json
git commit -m "feat(favorites): favorite_items admin-curated catalog table (migration 029)"
```

---

### Task 4: Favorites data layer + admin Favorites tab

**Files:**
- Modify: `src/data/db.ts`
- Create: `src/purchasing/FavoritesTab.tsx`
- Modify: `src/pages/PurchasingPage.tsx`

**Interfaces:**
- Consumes: Task 3's `favorite_items` table.
- Produces: `FavoriteItem` type; `api.listFavorites(): Promise<FavoriteItem[]>`; `api.addFavorite(name: string, itemUrl?: string | null)`; `api.removeFavorite(id: string)`; `FavoritesTab` component; "Favorites" tab on Purchasing (admin-only).

- [ ] **Step 1: Add favorites helpers to `src/data/db.ts`**

After the `ShipToWorker` interface (line 45):

```ts
export interface FavoriteItem { id: string; name: string; item_url: string | null; created_by: string | null; created_at: string }
```

After `listShipToWorkers` (before the `return` block):

```ts
  async function listFavorites(): Promise<FavoriteItem[]> {
    return (ok(await db().from('favorite_items').select('*').order('name')) ?? []) as FavoriteItem[]
  }
  async function addFavorite(name: string, itemUrl?: string | null): Promise<void> {
    ok(await db().from('favorite_items').insert({ name, item_url: itemUrl || null }))
  }
  async function removeFavorite(id: string): Promise<void> {
    ok(await db().from('favorite_items').delete().eq('id', id))
  }
```

Add `listFavorites, addFavorite, removeFavorite` to the returned object (line 255).

- [ ] **Step 2: Create `src/purchasing/FavoritesTab.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, FavoriteItem } from '../data/db'
import { formatDate } from '../lib/constants'

// Admin-curated catalog of standard items, surfaced as auto-suggestions in
// request forms. Only procurement admins reach this tab (PurchasingPage gates it).
export function FavoritesTab() {
  const api = useProcurementApi()
  const { showToast } = useToast()

  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFavorites(await api.listFavorites())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load favorites')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name || adding) return
    setAdding(true)
    try {
      await api.addFavorite(name, newUrl.trim() || null)
      showToast({ message: `Added "${name}" to favorites`, type: 'success' })
      setNewName('')
      setNewUrl('')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add favorite'
      showToast({ message: /uq_favorite|duplicate/i.test(msg) ? 'An item with that name already exists' : msg, type: 'error' })
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(fav: FavoriteItem) {
    if (!window.confirm(`Remove "${fav.name}" from favorites?`)) return
    setRemovingId(fav.id)
    try {
      await api.removeFavorite(fav.id)
      showToast({ message: 'Favorite removed', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to remove favorite', type: 'error' })
    } finally {
      setRemovingId(null)
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={handleAdd} className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Item name (required)"
          className="h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="url"
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          placeholder="Item URL (optional)"
          className="h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={adding || !newName.trim()}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add Favorite'}
        </button>
      </form>

      {favorites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No favorite items yet. Add a standard item so it's suggested in request forms.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Name</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">URL</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Added</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {favorites.map(fav => (
                <tr key={fav.id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-foreground">{fav.name}</td>
                  <td className="px-3 py-2 text-xs">
                    {fav.item_url ? (
                      <a href={fav.item_url} target="_blank" rel="noreferrer" className="text-primary underline break-all">{fav.item_url}</a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(fav.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      disabled={removingId === fav.id}
                      onClick={() => handleRemove(fav)}
                      className="inline-flex items-center rounded-md bg-destructive/15 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add the tab to `src/pages/PurchasingPage.tsx`**

Replace the whole file with:

```tsx
import { useState } from 'react'
import { useAppPermissions } from '../lib/useAppPermissions'
import { PERMS } from '../lib/constants'
import { ReadyForPurchasing } from '../purchasing/ReadyForPurchasing'
import { OpenOrders } from '../purchasing/OpenOrders'
import { ClosedOrders } from '../purchasing/ClosedOrders'
import { FavoritesTab } from '../purchasing/FavoritesTab'

type Tab = 'ready' | 'open' | 'closed' | 'favorites'

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

  // The Favorites tab is the admin-curated catalog manager — visible to
  // procurement admins only. Non-admin purchasers never see it.
  const canManageFavorites = hasAppPermission(PERMS.admin)
  const tabs: { key: Tab; label: string }[] = [
    { key: 'ready', label: 'Ready for Purchasing' },
    { key: 'open', label: 'Open Orders' },
    { key: 'closed', label: 'Closed Orders' },
    ...(canManageFavorites ? [{ key: 'favorites' as Tab, label: 'Favorites' }] : []),
  ]

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
      {tab === 'favorites' && canManageFavorites && <FavoritesTab />}
    </div>
  )
}

export default PurchasingPage
```

- [ ] **Step 4: Typecheck + test**

Run: `npm run build` — expected: clean.
Run: `npm test` — expected: 33 pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/db.ts src/purchasing/FavoritesTab.tsx src/pages/PurchasingPage.tsx
git commit -m "feat(favorites): admin Favorites tab on Purchasing (add/remove/list catalog)"
```

---

### Task 5: Item Name combobox with favorite suggestions

**Files:**
- Create: `src/requester/ItemNameCombobox.tsx`
- Create: `src/requester/ItemNameCombobox.test.ts`
- Modify: `src/requester/LineItemFormRow.tsx`
- Modify: `src/requester/NewRequestForm.tsx`

**Interfaces:**
- Consumes: Task 4's `FavoriteItem` + `api.listFavorites()`.
- Produces: `ItemNameCombobox` component; pure helper `filterFavorites(favorites: FavoriteItem[], query: string): FavoriteItem[]`.

- [ ] **Step 1: Write the failing test**

`src/requester/ItemNameCombobox.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterFavorites } from './ItemNameCombobox'
import type { FavoriteItem } from '../data/db'

function fav(id: string, name: string): FavoriteItem {
  return { id, name, item_url: null, created_by: null, created_at: '' }
}

describe('filterFavorites', () => {
  it('returns all favorites for an empty query', () => {
    const list = [fav('1', 'Dell 27" Monitor'), fav('2', 'HP Keyboard')]
    expect(filterFavorites(list, '')).toHaveLength(2)
    expect(filterFavorites(list, '   ')).toHaveLength(2)
  })

  it('filters case-insensitive substring', () => {
    const list = [fav('1', 'Dell 27" Monitor'), fav('2', 'HP Keyboard')]
    expect(filterFavorites(list, 'dell')).toEqual([fav('1', 'Dell 27" Monitor')])
  })

  it('trims the query before matching', () => {
    const list = [fav('1', 'Dell 27" Monitor')]
    expect(filterFavorites(list, '  dell  ')).toHaveLength(1)
  })

  it('returns empty when nothing matches', () => {
    expect(filterFavorites([fav('1', 'Dell 27" Monitor')], 'nonexistent')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/requester/ItemNameCombobox.test.ts`
Expected: FAIL — "ItemNameCombobox" does not exist / `filterFavorites` not exported.

- [ ] **Step 3: Write `src/requester/ItemNameCombobox.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { FavoriteItem } from '../data/db'

export interface FavoriteSuggestion { name: string; item_url: string | null }

// Pure: case-insensitive substring filter over the favorites catalog.
// Empty/whitespace query returns the full list.
export function filterFavorites(favorites: FavoriteItem[], query: string): FavoriteItem[] {
  const q = query.trim().toLowerCase()
  return q ? favorites.filter((f) => f.name.toLowerCase().includes(q)) : favorites
}

interface ItemNameComboboxProps {
  value: string
  onChange: (v: string, url?: string | null) => void
  favorites: FavoriteItem[]
}

// Searchable dropdown over the admin-curated favorites catalog with a
// free-text fallback (mirrors ShipToCombobox). Typing updates the value live
// so any typed name is captured even if it matches no favorite; selecting a
// favorite sets the name and, when present, the favorite's item URL. If the
// list is empty (or failed to load), it behaves as a plain text input.
export function ItemNameCombobox({ value, onChange, favorites }: ItemNameComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = filterFavorites(favorites, query)

  function commit(fav: FavoriteItem) {
    onChange(fav.name, fav.item_url)
    setQuery(fav.name)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, Math.max(matches.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[highlight]) commit(matches[highlight]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); setHighlight(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={favorites.length ? 'Type an item name or pick a favorite' : 'e.g. Dell 27" Monitor'}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg" role="listbox">
          {matches.map((f, i) => (
            <li
              key={f.id}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => { e.preventDefault(); commit(f) }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3 py-1.5 text-sm text-foreground ${i === highlight ? 'bg-primary/10' : ''}`}
            >
              {f.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/requester/ItemNameCombobox.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Wire into `src/requester/LineItemFormRow.tsx`**

a) Imports (top of file): add

```tsx
import { FavoriteItem } from '../data/db'
import { ItemNameCombobox } from './ItemNameCombobox'
```

b) `LineItemFormRowProps` interface: add `favorites: FavoriteItem[]` after `workersLoading: boolean`.

c) Destructure: add `favorites` to the component params.

d) Replace the Item Name field (lines 189-198) with:

```tsx
      {/* Item Name */}
      <Field label="Item Name" error={errors.item_description}>
        <ItemNameCombobox
          value={value.item_description}
          onChange={(name, url) => set({ item_description: name, ...(url && !value.item_url ? { item_url: url } : {}) })}
          favorites={favorites}
        />
        <p className="text-xs text-muted-foreground">Tip: favorite items are suggested as you type.</p>
      </Field>
```

- [ ] **Step 6: Load favorites in `src/requester/NewRequestForm.tsx`**

a) Import: change line 3 to `import { useProcurementApi, Location, Department, FavoriteItem } from '../data/db'`

b) State (after line 58 `const [departments, setDepartments] = useState<Department[]>([])`):

```tsx
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
```

c) Effect (after the locations/departments effect, line 65):

```tsx
  // Best-effort: on load failure the form degrades to a plain text input.
  useEffect(() => {
    api.listFavorites().then(setFavorites).catch(() => setFavorites([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

d) In the `<LineItemFormRow>` usage (lines 132-145), add `favorites={favorites}` after `onRefreshWorkers={refreshWorkers}`.

- [ ] **Step 7: Full typecheck + tests**

Run: `npm run build` — expected: clean.
Run: `npm test` — expected: 37 pass (33 + 4 new).

- [ ] **Step 8: Commit**

```bash
git add src/requester/ItemNameCombobox.tsx src/requester/ItemNameCombobox.test.ts src/requester/LineItemFormRow.tsx src/requester/NewRequestForm.tsx
git commit -m "feat(favorites): Item Name combobox with favorite auto-suggest in request forms"
```

---

### Task 6: Notification scoping — "New request to approve" to admins + approvers

**Files:**
- Modify: `supabase/functions/procurement-capture-and-notify/index.ts` (generic `notification` handler, ~lines 203-253)

**Interfaces:**
- Consumes: existing RPC `app_procurement.get_permission_holders(p_permission text)` (returns `{user_id, email}[]`; wildcard-aware via `check_user_permission`, so system admins + `apps/procurement/*` holders are included); existing `APPROVE_PERMISSION = 'apps/procurement/approvals/act'` const (line 11).
- Produces: bell rows + notification email for event `procurement:request_submitted` delivered only to approver-permission holders. All other event keys unchanged.

- [ ] **Step 1: Edit the notification handler**

In `supabase/functions/procurement-capture-and-notify/index.ts`, in the `if (event === 'notification') {` block, replace:

```ts
    const recipients = await resolveNotificationRecipients(db, eventType)
    if (recipients.length === 0) return json({ event: 'notification', key, skipped: true, reason: 'no recipients' })
```

with:

```ts
    let recipients = await resolveNotificationRecipients(db, eventType)
    // "New request to approve" is approver-facing: restrict delivery to users who
    // can actually approve (system admins + approvals/act + full-access holders
    // via wildcard match) even if they opted in. Requesters should only receive
    // notifications about their own requests.
    if (key === 'request_submitted') {
      const { data: holders, error: holderErr } = await db.schema('app_procurement').rpc('get_permission_holders', { p_permission: APPROVE_PERMISSION })
      if (holderErr) console.error('get_permission_holders failed:', holderErr.message)
      else {
        const holderIds = new Set(((holders ?? []) as Array<{ user_id: string }>).map((h) => h.user_id))
        recipients = recipients.filter((r) => r.user_id !== null && holderIds.has(r.user_id))
      }
    }
    if (recipients.length === 0) return json({ event: 'notification', key, skipped: true, reason: 'no recipients' })
```

No other lines in the block change (bell rows and email both read the same `recipients` variable, so both are scoped).

- [ ] **Step 2: Deploy to QA Supabase**

MCP `supabase_deploy_edge_function` with `project_id: "jkbqaxpfvqbeepwhunhl"`, `name: "procurement-capture-and-notify"`, `entrypoint_path: "index.ts"`, `verify_jwt: false`, `files:` = the 4 local files under `supabase/functions/procurement-capture-and-notify/` (`index.ts`, `emails.ts`, `smtp.ts`, `mime.ts`) with their current on-disk content.

- [ ] **Step 3: Verify**

MCP `supabase_list_edge_functions` (QA) — `procurement-capture-and-notify` version incremented (was 31).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/procurement-capture-and-notify/index.ts
git commit -m "fix(notifications): scope 'New request to approve' to admins + approvers"
```

Manual QA verification (later, with the QA portal): submit a request as a requester account — approver + admin get bell + email, the requester does not.

---

### Task 7: Conditional formatting font styles

**Files:**
- Modify: `src/formatting/rules.ts`
- Create: `src/formatting/rules.test.ts`
- Modify: `src/formatting/tones.ts`
- Modify: `src/formatting/useFormattingRules.ts`
- Modify: `src/pages/AdminPage.tsx` (FormattingRuleRow + handleAdd + card description)

**Interfaces:**
- Produces: `FormatRule.bold?/italic?/underline?: boolean`; `RowFormat { tone, bold, italic, underline }`; `evalRowFormat(row, rules, now?): RowFormat`; `FONT_CLASS` map; `toneClassFor` returns combined bg+font class string (signature unchanged, so all existing call sites — ApprovalsPage, ReturnsPage, ReadyForPurchasing, RecordsPage, RequestsList — need no changes).

- [ ] **Step 1: Write the failing test**

`src/formatting/rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evalRowFormat, DEFAULT_RULES, type FormatRule } from './rules'

const base: FormatRule = { id: 'x', field: 'status', operator: 'equals', value: 'pending', tone: 'blue', enabled: true }

describe('evalRowFormat', () => {
  it('returns matched tone and font flags', () => {
    const f = evalRowFormat({ status: 'pending' }, [{ ...base, bold: true, underline: true }])
    expect(f).toEqual({ tone: 'blue', bold: true, italic: false, underline: true })
  })

  it('defaults font flags to false for legacy saved rules', () => {
    const f = evalRowFormat({ status: 'pending' }, [base])
    expect(f).toEqual({ tone: 'blue', bold: false, italic: false, underline: false })
  })

  it('first enabled match wins', () => {
    const f = evalRowFormat({ status: 'pending' }, [{ ...base, tone: 'red', bold: true }, { ...base, tone: 'green' }])
    expect(f.tone).toBe('red')
    expect(f.bold).toBe(true)
  })

  it('skips disabled rules', () => {
    const f = evalRowFormat({ status: 'pending' }, [{ ...base, enabled: false }])
    expect(f.tone).toBe('neutral')
  })

  it('overdue default rule tints past date_needed red', () => {
    const f = evalRowFormat({ status: 'pending', date_needed: '2020-01-01' }, DEFAULT_RULES)
    expect(f.tone).toBe('red')
  })

  it('returns neutral with no matches', () => {
    const f = evalRowFormat({ status: 'received' }, [base])
    expect(f).toEqual({ tone: 'neutral', bold: false, italic: false, underline: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/formatting/rules.test.ts`
Expected: FAIL — `evalRowFormat` is not a function.

- [ ] **Step 3: Update `src/formatting/rules.ts`**

a) `FormatRule` interface — add the three optional flags before `enabled`:

```ts
export interface FormatRule { id: string; label?: string; field: FormatField; operator: FormatOperator; value: string | null; tone: Tone; bold?: boolean; italic?: boolean; underline?: boolean; enabled: boolean }
```

b) Replace `evalRowTone` (lines 71-78) with:

```ts
// Presentation of the first enabled matching rule: background tone plus any
// font flags. Total: never throws. Legacy rules without font flags render none.
export interface RowFormat { tone: Tone; bold: boolean; italic: boolean; underline: boolean }
export function evalRowFormat(row: Record<string, unknown>, rules: FormatRule[], now: Date = new Date()): RowFormat {
  for (const r of rules) {
    if (!r.enabled) continue
    try { if (matchRule(row, r, now)) return { tone: r.tone, bold: !!r.bold, italic: !!r.italic, underline: !!r.underline } } catch { /* skip bad rule */ }
  }
  return { tone: 'neutral', bold: false, italic: false, underline: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/formatting/rules.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Update `src/formatting/tones.ts`**

Append at the end (literal classes so Tailwind's @source scan bundles them):

```ts
// Literal font-style classes (same @source-scan constraint as TONE_CLASS).
export const FONT_CLASS = { bold: 'font-bold', italic: 'italic', underline: 'underline' } as const
```

- [ ] **Step 6: Replace `src/formatting/useFormattingRules.ts`**

```ts
import { useState, useEffect } from 'react'
import { useProcurementApi } from '../data/db'
import { evalRowFormat, DEFAULT_RULES, type FormatRule } from './rules'
import { TONE_CLASS, FONT_CLASS } from './tones'

// Loads the active formatting rules once; returns a helper that maps a row to
// its tint + font-style classes. Starts from DEFAULT_RULES so styles show
// immediately, then overrides with any saved rules.
export function useFormattingRules(): { rules: FormatRule[]; toneClassFor: (row: Record<string, unknown>) => string } {
  const api = useProcurementApi()
  const [rules, setRules] = useState<FormatRule[]>(DEFAULT_RULES)
  useEffect(() => { api.getFormattingRules().then(setRules).catch(() => setRules(DEFAULT_RULES)) }, [])
  const toneClassFor = (row: Record<string, unknown>) => {
    const f = evalRowFormat(row, rules)
    return [TONE_CLASS[f.tone], f.bold ? FONT_CLASS.bold : '', f.italic ? FONT_CLASS.italic : '', f.underline ? FONT_CLASS.underline : '']
      .filter(Boolean).join(' ')
  }
  return { rules, toneClassFor }
}
```

- [ ] **Step 7: Update the editor in `src/pages/AdminPage.tsx`**

a) In `FormattingRuleRow`, after the tone `<select>` (closes at line 340), add:

```tsx
        <div className="flex items-center gap-2.5">
          {(['bold', 'italic', 'underline'] as const).map((k) => (
            <label key={k} className="inline-flex items-center gap-1 text-xs text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={!!rule[k]}
                onChange={e => onChange(index, { ...rule, [k]: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              {k === 'bold' ? 'Bold' : k === 'italic' ? 'Italic' : 'Underline'}
            </label>
          ))}
        </div>
```

b) `handleAdd` (line 415) — include explicit false flags:

```tsx
  function handleAdd() {
    setRules(prev => [...prev, { id: crypto.randomUUID(), field: 'status', operator: 'equals', value: '', tone: 'neutral', bold: false, italic: false, underline: false, enabled: true }])
  }
```

c) Card description (line 438) — update the sentence to:

```tsx
        Rules are evaluated top to bottom — the first enabled match sets the row's tint (and font style). Applies across Records, Requests, Approvals, Purchasing, and Returns.
```

- [ ] **Step 8: Full typecheck + tests**

Run: `npm run build` — expected: clean.
Run: `npm test` — expected: 43 pass (37 + 6).

- [ ] **Step 9: Commit**

```bash
git add src/formatting/rules.ts src/formatting/rules.test.ts src/formatting/tones.ts src/formatting/useFormattingRules.ts src/pages/AdminPage.tsx
git commit -m "feat(formatting): bold/italic/underline options in conditional formatting rules"
```

---

### Task 8: Version bump, build, package, push

**Files:**
- Modify: `package.json` (version)
- Modify: `app.manifest.json` (version)
- Delete: `dist/procurement-0.17.0.eitapp` (stale artifact)

- [ ] **Step 1: Bump version to 0.18.0**

In `package.json`: `"version": "0.18.0"`.
In `app.manifest.json`: `"version": "0.18.0"`.

- [ ] **Step 2: Full verification**

Run: `npm test` — expected: all 43 pass.
Run: `npm run package` (workdir `C:\Users\jbugahon\Code\msr-procurement-app`) — expected: prebuild validator clean, vite build + tsc clean, produces `dist/procurement-0.18.0.eitapp`.

- [ ] **Step 3: Remove stale artifact**

```powershell
Remove-Item "C:\Users\jbugahon\Code\msr-procurement-app\dist\procurement-0.17.0.eitapp"
Get-ChildItem "C:\Users\jbugahon\Code\msr-procurement-app\dist" -Filter *.eitapp
```
Expected: only `procurement-0.18.0.eitapp` remains.

- [ ] **Step 4: Commit + push**

```bash
git add package.json app.manifest.json
git commit -m "chore: bump to 0.18.0 (archive, favorites, notification scoping, font styles)"
git push origin for-qa
```

- [ ] **Step 5: Verify push**

```bash
git status
git log --oneline -9
```
Expected: clean tree, 9 commits ahead of the previous tip (Tasks 1-8 commits), `for-qa` in sync with origin.

---

### Task 9: ClickUp dev update

- [ ] **Step 1: Post concise dev update on task `86eymxb9v`**

Use ClickUp `create_comment` with the established format, kept SHORT (previous long comment was deleted by the user):

```
Procurement — Dev update (2026-08-25): v0.18.0 in progress

Phase 2 changes are on for-qa. New build: procurement-0.18.0.eitapp (manual upload via Admin → App Management).

✅ Completed
- Records: Delete button removed; admins can now Archive/Unarchive (toggle). Archived items hidden from Records default view, dashboard, and CSV export; "Show archived" toggle reveals them with an Archived badge.
- Favorites: new admin-curated item catalog. Purchasing → Favorites tab (admin only): add/remove standard items (name + optional URL). Request forms (in-app + private link, signed-in users) now auto-suggest favorites in the Item Name field as you type; picking one also fills the Item URL.
- Notifications: "New request to approve" now only goes to admins + approvers (opt-in still applies). Other notification types unchanged.
- Conditional Formatting: rules now support Bold / Italic / Underline (combinable) alongside the row tint.

How to test (QA portal):
1. Records — no Delete button; Archive a row → disappears from dashboard counts; toggle "Show archived" → Unarchive restores it.
2. Purchasing → Favorites (visible to admin only) — add an item, then on the New Request form type part of its name → suggestion appears; selecting fills name + URL.
3. Submit a request as a requester account → the requester's bell does NOT show "New request to approve"; an approver's does.
4. Admin → Conditional Formatting — add a rule with Bold + Underline → matching rows render that way across Records/Requests/Approvals/Purchasing/Returns.
```

- [ ] **Step 2: Tell the user the artifact is ready**

Report: `dist/procurement-0.18.0.eitapp` is ready for manual upload to the QA portal; QA Supabase has migrations 028+029 and the updated edge function.

---

## Self-Review Notes (completed at plan-write time)

- Spec coverage: item 1 → Tasks 1-2; item 2 → Tasks 3-5 (admin catalog + suggestions + private-link form via NewRequestForm reuse); item 3 → Task 6; item 4 → Task 7; version/deploy → Task 8; handover → Task 9. All spec sections mapped.
- Placeholder scan: none — every step carries exact code/SQL/commands.
- Type consistency: `FavoriteItem` (Task 4) used identically in Tasks 4-5; `evalRowFormat`/`RowFormat` (Task 7) consistent between rules.ts, test, and hook; `archiveLineItem(id, archived)` consistent between db.ts and RecordsPage; `listAllLineItemsDetailed(includeArchived?)` consistent between db.ts and RecordsPage; `filterFavorites` exported (Task 5 step 3) and imported by its test (step 1).
- Known edge case (documented, accepted): archiving an item that is still in a workflow status (e.g. approved) does NOT remove it from the Approvals/Purchasing/Returns queues — archive only affects Records default view, dashboard, and CSV. Flag for QA.
