# Wave A — UI Polish (v0.24.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wave A of Phase 3 — pure UI changes only: Records search bar, Returns page tabs (Purchasing-page style), Approvals "Items" → "For Approval" rename, and removal of the Purchasing "Favorite Items" tab.

**Architecture:** No schema, RPC, or edge-function changes. All work is in React components plus one pure helper (`src/lib/recordsFilter.ts`) with vitest coverage. Tab styling copies the existing Purchasing/Approvals pattern verbatim (`flex gap-1 border-b border-border` + `border-b-2 border-primary` active indicator).

**Tech Stack:** React 19, TypeScript, Tailwind v4 utilities, vitest, existing `useProcurementApi` data layer.

## Global Constraints

- Branch: `for-qa` in `C:\Users\jbugahon\Code\msr-procurement-app`. Never push production versions to `for-qa`; this wave is pre-release-safe plain version `0.24.0` (repo convention).
- Version: bump `0.23.4` → `0.24.0` in BOTH `package.json` and `app.manifest.json`.
- Build gate: `npm run prebuild` (manifest validator) must pass before build; `npm test` must be green (currently 50 tests / 10 files) before packaging.
- Packaging: `npm run package` → `dist\procurement-0.24.0.eitapp`; afterwards delete every older `dist\*.eitapp` so only the current version's artifact remains.
- No new npm dependencies. No shell (elasticit-shell) changes. No migration.
- Commit style: Conventional Commits with `; v0.24.0` suffix on the final bump commit (match `git log --oneline`).
- Windows/pwsh harness: `grep`/`glob` tools and inline `$` in `pwsh -Command` strings are broken — use the `read` tool or `.ps1` script files run via `pwsh -NoProfile -ExecutionPolicy Bypass -File`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/recordsFilter.ts` | Create | Pure search-text + filter helpers for the Records table |
| `src/lib/recordsFilter.test.ts` | Create | vitest coverage for the helpers |
| `src/data/db.ts` | Modify (lines 38–42, 144–158) | Add `po_number` join to `LineItemDetailed` so PO # is searchable |
| `src/records/RecordsPage.tsx` | Modify | Search input, filtered rows, result count, export-of-visible |
| `src/pages/ReturnsPage.tsx` | Modify | Replace stacked sections with Purchasing-style tab bar |
| `src/pages/PurchasingPage.tsx` | Modify | Remove `favorites` tab entry |
| `src/pages/ApprovalsPage.tsx` | Modify (line 88) | Rename tab label "Items" → "For Approval" |
| `package.json` | Modify | Version 0.23.4 → 0.24.0 |
| `app.manifest.json` | Modify | Version 0.23.4 → 0.24.0 |

`src/purchasing/FavoritesTab.tsx` is NOT deleted — `ApprovalsPage.tsx` still imports it.

---

### Task 1: Add `po_number` to `LineItemDetailed`

**Files:**
- Modify: `src/data/db.ts:38-42` (interface) and `src/data/db.ts:144-158` (`listAllLineItemsDetailed`)

**Interfaces:**
- Consumes: nothing
- Produces: `LineItemDetailed.po: { po_number: string } | null` — used by `filterRecords` in Task 2.

- [ ] **Step 1: Extend the interface**

In `src/data/db.ts`, replace lines 38–42:

```ts
export interface LineItemDetailed extends LineItemRow {
  request: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
  location: { name: string } | null
  department: { name: string } | null
  po: { po_number: string } | null
}
```

- [ ] **Step 2: Extend the query and mapping**

In `listAllLineItemsDetailed` (lines 144–158), replace the select string, cast, and map so `purchase_orders!po_id(po_number)` is joined:

```ts
  async function listAllLineItemsDetailed(includeArchived = false): Promise<LineItemDetailed[]> {
    let query = db().from(TABLES.lineItems)
      .select('*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at, status), purchase_orders!po_id(po_number), locations!location_id(name), departments!department_id(name)')
      .order('created_at', { ascending: false })
    if (!includeArchived) query = query.is('archived_at', null)
    const rows = ok(await query) ?? []
    return (rows as unknown as (LineItemRow & {
      purchase_requests: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
      purchase_orders: { po_number: string } | null
      locations: { name: string } | null
      departments: { name: string } | null
    })[]).map(row => {
      const { purchase_requests, purchase_orders, locations, departments, ...item } = row
      return { ...item, request: purchase_requests, po: purchase_orders, location: locations, department: departments } as LineItemDetailed
    })
  }
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: build succeeds (tsc emits declarations; no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/data/db.ts
git commit -m "feat(records): join po_number into LineItemDetailed for search support"
```

---

### Task 2: Search helper + tests (TDD)

**Files:**
- Create: `src/lib/recordsFilter.ts`
- Test: `src/lib/recordsFilter.test.ts`

**Interfaces:**
- Consumes: `LineItemDetailed` from `src/data/db` (type-only import)
- Produces:
  - `recordSearchText(item: LineItemDetailed): string`
  - `filterRecords(rows: LineItemDetailed[], keyword: string): LineItemDetailed[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/recordsFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterRecords, recordSearchText } from './recordsFilter'
import type { LineItemDetailed } from '../data/db'

function makeRow(overrides: Partial<LineItemDetailed> = {}): LineItemDetailed {
  return {
    id: 'li-1',
    request_id: 'req-1',
    item_description: 'Widget',
    item_url: 'https://example.com/widget',
    memo: null,
    quantity: 1,
    substitution_ok: false,
    status: 'pending',
    location_id: null,
    custom_location: null,
    department_id: null,
    custom_department: null,
    date_needed: null,
    eta: null,
    admin_comment: null,
    commented_by: null,
    commented_at: null,
    product_image_path: null,
    return_reason: null,
    return_quantity: null,
    wants_replacement: null,
    return_notes: null,
    return_date: null,
    created_at: '2026-08-27T00:00:00Z',
    line_no: 1,
    return_processed_at: null,
    po_id: null,
    archived_at: null,
    request: {
      id: 'req-1',
      request_number: 34,
      requester_name: 'Jane Doe',
      requester_email: 'jane@example.com',
      notes: null,
      submitted_at: '2026-08-01T00:00:00Z',
      status: 'pending',
    },
    location: null,
    department: null,
    po: null,
    ...overrides,
  }
}

describe('recordSearchText', () => {
  it('includes item description, requester, request number, po number, status, location, department', () => {
    const row = makeRow({
      po: { po_number: 'PO-2026-0008' },
      location: { name: 'Main Store' },
      department: { name: 'Operations' },
      custom_location: 'Main Store',
      custom_department: 'Operations',
    })
    const text = recordSearchText(row)
    expect(text).toContain('widget')
    expect(text).toContain('jane doe')
    expect(text).toContain('req-34')
    expect(text).toContain('po-2026-0008')
    expect(text).toContain('pending')
    expect(text).toContain('main store')
    expect(text).toContain('operations')
  })

  it('falls back to custom location/department when location/department objects are null', () => {
    const row = makeRow({ custom_location: 'Dock 7', custom_department: 'Warehouse' })
    const text = recordSearchText(row)
    expect(text).toContain('dock 7')
    expect(text).toContain('warehouse')
  })
})

describe('filterRecords', () => {
  const rows = [
    makeRow({ id: 'li-1', item_description: 'Widget' }),
    makeRow({ id: 'li-2', item_description: 'Widget Pro', item_url: 'https://example.com/widget-pro', request: { ...makeRow().request, request_number: 55, requester_email: 'jane2@example.com' } }),
    makeRow({ id: 'li-3', item_description: 'Gadget', item_url: 'https://example.com/gadget', po: { po_number: 'PO-2026-0009' }, request: { ...makeRow().request, requester_email: 'jane3@example.com' } }),
  ]

  it('returns all rows for empty or whitespace keyword', () => {
    expect(filterRecords(rows, '')).toHaveLength(3)
    expect(filterRecords(rows, '   ')).toHaveLength(3)
  })

  it('matches item description case-insensitively', () => {
    const result = filterRecords(rows, 'wIdGeT')
    expect(result.map((r) => r.id)).toEqual(['li-1', 'li-2'])
  })

  it('matches request number', () => {
    expect(filterRecords(rows, 'req-55').map((r) => r.id)).toEqual(['li-2'])
    expect(filterRecords(rows, '55').map((r) => r.id)).toEqual(['li-2'])
  })

  it('matches PO number case-insensitively', () => {
    expect(filterRecords(rows, 'po-2026-0009').map((r) => r.id)).toEqual(['li-3'])
  })

  it('matches requester email', () => {
    expect(filterRecords(rows, 'JANE@example.com').map((r) => r.id)).toEqual(['li-1'])
  })

  it('returns empty array when nothing matches', () => {
    expect(filterRecords(rows, 'zzz-no-match')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/recordsFilter.test.ts`
Expected: FAIL — `Cannot find module './recordsFilter'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/recordsFilter.ts`:

```ts
import type { LineItemDetailed } from '../data/db'

export function recordSearchText(item: LineItemDetailed): string {
  return [
    item.item_description ?? '',
    item.item_url ?? '',
    item.request.requester_name ?? '',
    item.request.requester_email ?? '',
    item.request.request_number != null ? `req-${item.request.request_number}` : '',
    item.po?.po_number ?? '',
    item.status ?? '',
    item.location?.name ?? item.custom_location ?? '',
    item.department?.name ?? item.custom_department ?? '',
  ].join(' ').toLowerCase()
}

export function filterRecords(rows: LineItemDetailed[], keyword: string): LineItemDetailed[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) => recordSearchText(row).includes(q))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/recordsFilter.test.ts`
Expected: PASS — 8 tests.
Run: `npm test`
Expected: all suites green (58 tests / 11 files).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recordsFilter.ts src/lib/recordsFilter.test.ts
git commit -m "feat(records): add pure search helper for records table filtering"
```

---

### Task 3: Records page search UI

**Files:**
- Modify: `src/records/RecordsPage.tsx`

**Interfaces:**
- Consumes: `filterRecords` from `../lib/recordsFilter` (Task 2), `LineItemDetailed.po` (Task 1)
- Produces: nothing (leaf UI)

- [ ] **Step 1: Add imports and state**

In `src/records/RecordsPage.tsx`:
- Change line 1 import to add `useMemo`:
  ```ts
  import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
  ```
- Add after the existing imports:
  ```ts
  import { filterRecords } from '../lib/recordsFilter'
  ```
- Add state next to `showArchived` (line 70):
  ```ts
  const [query, setQuery] = useState('')
  const visible = useMemo(() => filterRecords(items, query), [items, query])
  ```

- [ ] **Step 2: Add the search input to the header**

In `src/records/RecordsPage.tsx`, replace the header controls block (lines 140–158):

```tsx
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
```

with:

```tsx
        <div className="flex items-center gap-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item, requester, request #, PO #, status, location…"
            className="w-72 rounded-md border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
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
```

(Only change: the new `<input type="search">` as first child; the "Show archived" label and Export CSV button are byte-identical — Export is fixed in Step 4.)

- [ ] **Step 3: Render filtered rows + result count**

- Keep the table wrapper guard `!loading && !error && items.length > 0` unchanged.
- Inside `<tbody>`, change `{items.map(item => (` to `{visible.map(item => (`.
- Change the empty state (line 171) to distinguish "no data" from "no matches":
  ```tsx
      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No records yet.</p>
      )}

      {!loading && !error && items.length > 0 && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No items match your search.</p>
      )}
  ```
- Add a result count line directly above the table wrapper `<div className="overflow-x-auto ...">`:
  ```tsx
          <p className="text-xs text-muted-foreground">
            {visible.length} of {items.length} items
          </p>
  ```

- [ ] **Step 4: Export the visible rows**

Change the Export CSV button's onClick from `() => exportCsv(items)` to `() => exportCsv(visible)` so exports reflect the active search.

- [ ] **Step 5: Verify build + tests**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/records/RecordsPage.tsx
git commit -m "feat(records): keyword search bar with result count; export reflects filter"
```

---

### Task 4: Returns page tabs (Purchasing style)

**Files:**
- Modify: `src/pages/ReturnsPage.tsx:103-207`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing (leaf UI)

- [ ] **Step 1: Add tab state**

In `ReturnsPage`, add after the `busyId` state (line 111):

```ts
  const [tab, setTab] = useState<'pending' | 'processed'>('pending')
```

- [ ] **Step 2: Replace the stacked sections with a tab bar**

Replace the block from `{!loading && !error && (` through its closing `)}` (lines 169–204) with:

```tsx
      {!loading && !error && (
        <>
          <div className="flex gap-1 border-b border-border">
            <button
              type="button"
              onClick={() => setTab('pending')}
              className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'pending' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              Pending Returns ({pending.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('processed')}
              className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'processed' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              Processed Returns ({processed.length})
            </button>
          </div>

          {tab === 'pending' && (
            <div className="grid gap-4">
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items awaiting return processing.</p>
              ) : (
                <div className="grid gap-3">
                  {pending.map((item) => (
                    <ReturnCard
                      key={item.id}
                      item={item}
                      busy={busyId === item.id}
                      onProcess={handleProcess}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'processed' && (
            <div className="grid gap-4">
              {processed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No processed returns yet.</p>
              ) : (
                <div className="grid gap-3">
                  {processed.map((item) => (
                    <ReturnCard key={item.id} item={item} busy={false} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
```

The old `<h2>` section headings are gone — the tab labels now carry the counts.

- [ ] **Step 3: Verify build + tests**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ReturnsPage.tsx
git commit -m "feat(returns): replace stacked sections with Purchasing-style tab bar"
```

---

### Task 5: Rename Approvals "Items" tab + remove Purchasing favorites tab

**Files:**
- Modify: `src/pages/ApprovalsPage.tsx:88`
- Modify: `src/pages/PurchasingPage.tsx:6-9,28-32,41,55`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Rename the Approvals tab label**

In `src/pages/ApprovalsPage.tsx` line 88, change `Items` to `For Approval`:

```tsx
          For Approval
```

(Keep the `key`/state value `'items'` unchanged — only the visible label changes.)

- [ ] **Step 2: Remove the favorites tab from PurchasingPage**

In `src/pages/PurchasingPage.tsx`:
- Delete line 6: `import { FavoritesTab } from '../purchasing/FavoritesTab'`
- Change line 9: `type Tab = 'ready' | 'open' | 'closed' | 'favorites'` → `type Tab = 'ready' | 'open' | 'closed'`
- Delete lines 28–32 (the comment block and `const tabs: ... = [...TABS, { key: 'favorites', label: 'Favorite Items' }]`)
- Change line 41: `{tabs.map(t => (` → `{TABS.map(t => (`
- Delete line 55: `{tab === 'favorites' && <FavoritesTab />}`

`src/purchasing/FavoritesTab.tsx` STAYS — `ApprovalsPage.tsx` imports it.

- [ ] **Step 3: Verify no dangling references**

Run: `pwsh -NoProfile -Command "Select-String -Path 'src\**\*.tsx' -Pattern 'FavoritesTab' | ForEach-Object { $_.Path + ':' + $_.LineNumber }"`
Expected: only `src\pages\ApprovalsPage.tsx` (import + usage) — nothing in PurchasingPage.
Run: `npm test && npm run build`
Expected: all tests pass; build succeeds (would fail on the unused import if step 2 was incomplete).

- [ ] **Step 4: Commit**

```bash
git add src/pages/ApprovalsPage.tsx src/pages/PurchasingPage.tsx
git commit -m "feat(tabs): rename Approvals items tab to For Approval; drop Favorite Items tab from Purchasing"
```

---

### Task 6: Version bump 0.24.0

**Files:**
- Modify: `package.json` (line 3)
- Modify: `app.manifest.json` (line 5)

- [ ] **Step 1: Bump versions**

- `package.json`: `"version": "0.23.4"` → `"version": "0.24.0"`
- `app.manifest.json`: `"version": "0.23.4"` → `"version": "0.24.0"`

- [ ] **Step 2: Verify validator passes**

Run: `npm run validate`
Expected: "no issues found" (validator checks manifest against package.json).

- [ ] **Step 3: Commit**

```bash
git add package.json app.manifest.json
git commit -m "chore: bump version to 0.24.0; v0.24.0"
```

---

### Task 7: Package + QA handover

**Files:**
- Create: `dist/procurement-0.24.0.eitapp` (build output)

- [ ] **Step 1: Full test + package**

Run: `npm test && npm run package`
Expected: all tests pass; `dist\procurement-0.24.0.eitapp` created; `scripts/validate.ts --strict` passes.

- [ ] **Step 2: Remove old build artifacts**

Run: `pwsh -NoProfile -Command "Remove-Item 'dist\procurement-0.23.4.eitapp' -ErrorAction SilentlyContinue; Get-ChildItem dist -Filter *.eitapp | Select-Object -ExpandProperty Name"`
Expected: only `procurement-0.24.0.eitapp` remains.

- [ ] **Step 3: Push**

```bash
git push origin for-qa
```

- [ ] **Step 4: QA handover (post to ClickUp task, format per repo AGENTS.md)**

Deploy: upload `dist\procurement-0.24.0.eitapp` via Admin > App Management on the QA portal, hard-refresh.

Expected behavior (pass/fail):
1. Returns page shows a tab bar: "Pending Returns (n)" / "Processed Returns (n)" with an underline indicator on the active tab — same look as Purchasing tabs. Processing a return moves its card to the Processed tab.
2. Approvals page first tab reads "For Approval" (was "Items"); behavior unchanged.
3. Purchasing page no longer has a "Favorite Items" tab; Approvals page still does.
4. Records page has a search box: typing filters rows by item name, requester name/email, request #, PO #, status, location, department (case-insensitive); result count "N of M items" updates; "No items match your search." shows when zero match; clearing the box restores all rows; Search combines with "Show archived"; Export CSV exports only the visible (filtered) rows.
5. No regressions: dashboard, Requests deep-link (`?request=<id>`), favorites hearts on Closed Orders.

---

## Notes for the executor

- Task order matters only in: 1 → 2 → 3 (db.ts type → helper → UI). Tasks 4 and 5 are independent and parallelizable. Task 6 after all UI tasks; Task 7 last.
- This wave changes zero backend behavior. If QA reports any data discrepancy, the bug is pre-existing — do not "fix" it inside this wave.
- The `grep`/`glob` harness tools are broken in this environment; use the `read` tool or `.ps1` scripts.
