# Procurement App QA-Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six QA items from Gevenlie's 2026-07-03 review (ClickUp `86exz0ujv`): item-name display, request/line numbering, requester status tabs+counts, cancel-approved, replacement-return routing fix, and a formatting-rule clarification.

**Architecture:** Additive Postgres migrations (010–012) under schema `app_procurement`; all writes stay funnelled through `SECURITY DEFINER` RPCs. React/TS UI reads via the app-bridge `ProxyClient` (`src/data/db.ts`). New pure helpers get real Vitest unit tests (first tests in this repo); SQL + UI wiring is verified by validate/build + the `for-qa` QA gate.

**Tech Stack:** React 18 + TypeScript + Vite; Supabase Postgres (schema mode); Vitest 4 (jsdom available); app-bridge `ProxyClient`.

## Global Constraints

- **Never edit an applied migration.** Add new numbered files; next numbers are `010`, `011`, `012`. Register each in `app.manifest.json` under `database.migrations`.
- **Migration file format:** the deploy `exec_sql` splits on `";\n"`. Each SQL statement is on its own line ending in `;`. **Function bodies must be a single line** (internal `;` followed by a space, never a newline). Follow the existing 002/009 style exactly.
- **RPC convention actually used in this repo:** a single `SECURITY DEFINER` function in `app_procurement`, plus `REVOKE ALL ... FROM PUBLIC;` and `GRANT EXECUTE ... TO authenticated, service_role;`. (CLAUDE.md describes a public-wrapper / internal-definer split; existing migrations do **not** use it — match the real 002/009 pattern. The only `internal.` function is `proc_recompute_request_status`, called via `PERFORM`.)
- **Statuses are a closed enum in TWO places** — SQL `CHECK` constraints and `src/lib/constants.ts`. Any new status value must be added to both (and to `STATUS_TONE`).
- **Manifest is source of truth.** New notification key → declare in `app.manifest.json` AND fire it client-side (`api.fireNotification(key)`), matching the `item_approved`/`item_ordered` pattern. `request_submitted` is server-driven; the others fire from the client.
- **App version:** bump `app.manifest.json` `version` to `0.8.0` (MINOR).
- **Item identity:** `item_description` IS the item name (relabel the field; do not add a column). `memo` remains the reason field.
- **StatusBadge is generic:** it renders any status via `STATUS_TONE[status] ?? fallback` and `status.replace(/_/g,' ')` — a new status auto-renders once added to `STATUS_TONE`.

---

## File Structure

**Create**
- `vitest.config.ts` — test runner config (jsdom-capable, node default).
- `src/lib/itemRef.ts` — pure helpers: `formatRequestNo`, `formatItemRef`.
- `src/lib/itemRef.test.ts` — unit tests.
- `src/lib/requestFilter.ts` — pure helpers: `countByStatus`, `filterByStatus`.
- `src/lib/requestFilter.test.ts` — unit tests.
- `migrations/010_request_numbering.sql`
- `migrations/011_cancel_item.sql`
- `migrations/012_replacement_routing.sql`

**Modify**
- `src/lib/constants.ts` — add `cancelled` to `LINE_ITEM_STATUS`, `REQUEST_STATUS`, `STATUS_TONE`.
- `src/data/db.ts` — new `request_number`/`line_no` fields on row types; `cancelLineItem`; embed `request_number` in `listLineItemsByStatus`; embed line items in `listRequests`.
- `src/requester/LineItemFormRow.tsx` — relabel Item Description → Item Name.
- `src/requester/RequestsList.tsx` — request # + first item name/count; status tabs + counts.
- `src/requester/RequestDetail.tsx` — per-item `#req-line — name` header.
- `src/pages/ApprovalsPage.tsx` — item label with ref.
- `src/pages/PurchasingPage.tsx` — item label with ref; Cancel button; Replacement tag.
- `src/pages/ReturnsPage.tsx` — item label with ref.
- `src/records/RecordsPage.tsx` — admin "Return" action for received items.
- `src/pages/AdminPage.tsx` — one-line clarification on the formatting card.
- `app.manifest.json` — migrations 010–012, `item_cancelled` notification, version `0.8.0`.

---

## Task 1: Test harness + shared pure helpers

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/itemRef.ts`, `src/lib/itemRef.test.ts`
- Create: `src/lib/requestFilter.ts`, `src/lib/requestFilter.test.ts`

**Interfaces:**
- Produces: `formatRequestNo(n: number|null|undefined): string`; `formatItemRef(reqNo: number|null|undefined, lineNo: number|null|undefined): string`; `countByStatus<T extends {status:string}>(rows:T[]): Record<string,number>`; `filterByStatus<T extends {status:string}>(rows:T[], status:string): T[]`.

- [ ] **Step 1: Create the Vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 2: Write failing tests for `itemRef`**

`src/lib/itemRef.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatRequestNo, formatItemRef } from './itemRef'

describe('formatRequestNo', () => {
  it('formats a number', () => expect(formatRequestNo(123)).toBe('#123'))
  it('handles null', () => expect(formatRequestNo(null)).toBe('#—'))
  it('handles undefined', () => expect(formatRequestNo(undefined)).toBe('#—'))
})

describe('formatItemRef', () => {
  it('formats request + line', () => expect(formatItemRef(123, 2)).toBe('#123-2'))
  it('omits line when null', () => expect(formatItemRef(123, null)).toBe('#123'))
  it('handles null request', () => expect(formatItemRef(null, 2)).toBe('#—'))
})
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run src/lib/itemRef.test.ts`
Expected: FAIL — "Failed to resolve import './itemRef'".

- [ ] **Step 4: Implement `itemRef.ts`**

`src/lib/itemRef.ts`:
```ts
/** Human-readable request number, e.g. #123. Falls back to #— when unassigned. */
export function formatRequestNo(n: number | null | undefined): string {
  return n == null ? '#—' : `#${n}`
}

/** Per-item reference, e.g. #123-2. Drops the line suffix when unknown. */
export function formatItemRef(
  requestNo: number | null | undefined,
  lineNo: number | null | undefined,
): string {
  if (requestNo == null) return '#—'
  return lineNo == null ? `#${requestNo}` : `#${requestNo}-${lineNo}`
}
```

- [ ] **Step 5: Write failing tests for `requestFilter`**

`src/lib/requestFilter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { countByStatus, filterByStatus } from './requestFilter'

const rows = [
  { id: 'a', status: 'pending' },
  { id: 'b', status: 'approved' },
  { id: 'c', status: 'approved' },
]

describe('countByStatus', () => {
  it('counts each status plus all', () => {
    expect(countByStatus(rows)).toEqual({ all: 3, pending: 1, approved: 2 })
  })
  it('handles empty', () => expect(countByStatus([])).toEqual({ all: 0 }))
})

describe('filterByStatus', () => {
  it('filters by status', () => expect(filterByStatus(rows, 'approved').length).toBe(2))
  it('returns all for "all"', () => expect(filterByStatus(rows, 'all').length).toBe(3))
})
```

- [ ] **Step 6: Run tests, verify they fail**

Run: `npx vitest run src/lib/requestFilter.test.ts`
Expected: FAIL — cannot resolve `./requestFilter`.

- [ ] **Step 7: Implement `requestFilter.ts`**

`src/lib/requestFilter.ts`:
```ts
interface HasStatus { status: string }

/** Count rows per status value, plus an `all` total. */
export function countByStatus<T extends HasStatus>(rows: T[]): Record<string, number> {
  const counts: Record<string, number> = { all: rows.length }
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  return counts
}

/** Filter rows by a status value; the sentinel `all` returns everything. */
export function filterByStatus<T extends HasStatus>(rows: T[], status: string): T[] {
  return status === 'all' ? rows : rows.filter((r) => r.status === status)
}
```

- [ ] **Step 8: Run the full test suite, verify pass**

Run: `npm test`
Expected: PASS — 2 files, all cases green.

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts src/lib/itemRef.ts src/lib/itemRef.test.ts src/lib/requestFilter.ts src/lib/requestFilter.test.ts
git commit -m "test(procurement): add vitest + itemRef/requestFilter helpers"
```

---

## Task 2: Migration 010 — request & line numbering

**Files:**
- Create: `migrations/010_request_numbering.sql`
- Modify: `app.manifest.json` (`database.migrations` array)

**Interfaces:**
- Produces: `purchase_requests.request_number bigint` (sequence-defaulted); `line_items.line_no int` (BEFORE-INSERT trigger assigns per-request). Consumed by Tasks 4/5/6/7 UI.

- [ ] **Step 1: Write the migration**

`migrations/010_request_numbering.sql`:
```sql
-- 010: Phase 4 QA — human-readable request numbers + per-item line numbers.
-- request_number: global sequence, defaulted on insert; backfilled by submission order.
-- line_no: per-request 1..N, assigned by a BEFORE INSERT trigger (avoids editing submit_request).
CREATE SEQUENCE IF NOT EXISTS app_procurement.request_number_seq;
ALTER TABLE app_procurement.purchase_requests ADD COLUMN IF NOT EXISTS request_number bigint;
WITH ordered AS (SELECT id, row_number() OVER (ORDER BY submitted_at, id) AS rn FROM app_procurement.purchase_requests) UPDATE app_procurement.purchase_requests pr SET request_number = o.rn FROM ordered o WHERE pr.id = o.id AND pr.request_number IS NULL;
SELECT setval('app_procurement.request_number_seq', coalesce((SELECT max(request_number) FROM app_procurement.purchase_requests), 0) + 1, false);
ALTER TABLE app_procurement.purchase_requests ALTER COLUMN request_number SET DEFAULT nextval('app_procurement.request_number_seq');
ALTER TABLE app_procurement.line_items ADD COLUMN IF NOT EXISTS line_no int;
WITH ordered AS (SELECT id, row_number() OVER (PARTITION BY request_id ORDER BY created_at, id) AS rn FROM app_procurement.line_items) UPDATE app_procurement.line_items li SET line_no = o.rn FROM ordered o WHERE li.id = o.id AND li.line_no IS NULL;
CREATE OR REPLACE FUNCTION internal.proc_assign_line_no() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ BEGIN IF NEW.line_no IS NULL THEN SELECT coalesce(max(line_no),0)+1 INTO NEW.line_no FROM app_procurement.line_items WHERE request_id = NEW.request_id; END IF; RETURN NEW; END; $fn$;
DROP TRIGGER IF EXISTS trg_assign_line_no ON app_procurement.line_items;
CREATE TRIGGER trg_assign_line_no BEFORE INSERT ON app_procurement.line_items FOR EACH ROW EXECUTE FUNCTION internal.proc_assign_line_no();
```

- [ ] **Step 2: Register the migration in the manifest**

In `app.manifest.json`, append to the `database.migrations` array (match the existing entries' shape — file path + description), e.g.:
```json
{ "file": "migrations/010_request_numbering.sql", "description": "Phase 4 QA: request_number sequence + per-item line_no trigger + backfill" }
```
(Read the array first; copy the exact key names/format used by 001–009.)

- [ ] **Step 3: Validate the manifest + migration wiring**

Run: `npm run validate`
Expected: "no issues found" (validator lists the migration).

- [ ] **Step 4: Commit**

```bash
git add migrations/010_request_numbering.sql app.manifest.json
git commit -m "feat(procurement): migration 010 — request_number + line_no"
```

---

## Task 3: Migration 011 — cancel an approved item

**Files:**
- Create: `migrations/011_cancel_item.sql`
- Modify: `app.manifest.json`

**Interfaces:**
- Consumes: `internal.proc_recompute_request_status` (redefined here to handle `cancelled`).
- Produces: status value `cancelled` on both tables; RPC `app_procurement.cancel_line_item(p_line_item_id uuid) RETURNS void` — gate `status='approved'`, perm approve|purchase|admin. Consumed by Task 4 (`db.ts`) and Task 8 (Purchasing UI).

- [ ] **Step 1: Write the migration**

`migrations/011_cancel_item.sql`:
```sql
-- 011: Phase 4 QA — cancel an approved item (terminal 'cancelled'); requester resubmits.
-- Widen both status CHECK constraints, teach the rollup about cancelled, add cancel_line_item.
ALTER TABLE app_procurement.line_items DROP CONSTRAINT IF EXISTS line_items_status_check;
ALTER TABLE app_procurement.line_items ADD CONSTRAINT line_items_status_check CHECK (status IN ('pending','approved','declined','on_hold','ordered','received','returned','replacement_ordered','cancelled'));
ALTER TABLE app_procurement.purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
ALTER TABLE app_procurement.purchase_requests ADD CONSTRAINT purchase_requests_status_check CHECK (status IN ('pending','on_hold','partially_approved','approved','declined','cancelled'));
CREATE OR REPLACE FUNCTION internal.proc_recompute_request_status(p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE n int; n_canc int; n_decl int; n_pend int; n_appr int; n_hold int; n_eff int; BEGIN SELECT count(*), count(*) FILTER (WHERE status='cancelled'), count(*) FILTER (WHERE status='declined'), count(*) FILTER (WHERE status='pending'), count(*) FILTER (WHERE status IN ('approved','ordered','received','returned','replacement_ordered')), count(*) FILTER (WHERE status='on_hold') INTO n, n_canc, n_decl, n_pend, n_appr, n_hold FROM app_procurement.line_items WHERE request_id = p_request_id; n_eff := n - n_canc; UPDATE app_procurement.purchase_requests SET status = CASE WHEN n=0 THEN 'pending' WHEN n_eff=0 THEN 'cancelled' WHEN n_decl=n_eff THEN 'declined' WHEN n_pend=n_eff THEN 'pending' WHEN n_hold>0 AND n_appr=0 THEN 'on_hold' WHEN n_pend=0 AND n_hold=0 AND n_appr>0 THEN 'approved' WHEN n_appr>0 THEN 'partially_approved' ELSE 'pending' END, updated_at = now() WHERE id = p_request_id; END; $fn$;
CREATE OR REPLACE FUNCTION app_procurement.cancel_line_item(p_line_item_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_req uuid; BEGIN IF NOT (public.check_user_permission(auth.uid(),'apps/procurement/approvals/act') OR public.check_user_permission(auth.uid(),'apps/procurement/purchasing/manage') OR public.check_user_permission(auth.uid(),'apps/procurement/admin/manage')) THEN RAISE EXCEPTION 'Not permitted to cancel'; END IF; UPDATE app_procurement.line_items SET status='cancelled', updated_at=now() WHERE id=p_line_item_id AND status='approved' RETURNING request_id INTO v_req; IF v_req IS NULL THEN RAISE EXCEPTION 'Item not found or not approved'; END IF; PERFORM internal.proc_recompute_request_status(v_req); END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.cancel_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.cancel_line_item(uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Register in manifest**

Append to `database.migrations`:
```json
{ "file": "migrations/011_cancel_item.sql", "description": "Phase 4 QA: cancel approved item -> cancelled; rollup + CHECK updates" }
```

- [ ] **Step 3: Validate**

Run: `npm run validate`
Expected: no issues found.

- [ ] **Step 4: Commit**

```bash
git add migrations/011_cancel_item.sql app.manifest.json
git commit -m "feat(procurement): migration 011 — cancel_line_item + cancelled status"
```

---

## Task 4: Data-layer wiring (constants, row types, RPC)

**Files:**
- Modify: `src/lib/constants.ts`
- Modify: `src/data/db.ts`

**Interfaces:**
- Consumes: RPC `cancel_line_item` (Task 3); columns `request_number`, `line_no` (Task 2).
- Produces: `LINE_ITEM_STATUS`/`REQUEST_STATUS` include `cancelled`; `STATUS_TONE.cancelled`; `RequestRow.request_number`, `LineItemRow.line_no`; `api.cancelLineItem(id)`; `listLineItemsByStatus` rows carry `request.request_number`; `listRequests` rows carry `line_items:{item_description}[]`.

- [ ] **Step 1: Add `cancelled` to constants**

In `src/lib/constants.ts`:
- `LINE_ITEM_STATUS` → append `,'cancelled'` before `] as const`.
- `REQUEST_STATUS` → append `,'cancelled'` before `] as const`.
- `STATUS_TONE` → add entry: `cancelled: 'bg-destructive/10 text-destructive',`

- [ ] **Step 2: Add row-type fields in `db.ts`**

In `src/data/db.ts` (row interfaces, ~lines 9–26):
- Add to `RequestRow`: `request_number: number | null`
- Add to `LineItemRow`: `line_no: number | null`

- [ ] **Step 3: Add the `cancel` RPC name + client function**

In `src/data/db.ts`:
- In the `RPCS` map add: `cancel: 'cancel_line_item',`
- Add the function (mirror `decideLineItem`) and export it in the returned api object:
```ts
async function cancelLineItem(id: string): Promise<void> {
  ok(await db().rpc(RPCS.cancel, { p_line_item_id: id }))
}
```

- [ ] **Step 4: Expose `request_number` to item-level views**

In `listLineItemsByStatus` (`db.ts` ~line 88), add `request_number` to the embedded select and to its mapped type:
- Select string: `'*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at)'`
- Mapped embed type: add `request_number: number | null` to the `purchase_requests` shape.

- [ ] **Step 5: Embed line items in `listRequests`**

Change `listRequests` (`db.ts` ~lines 36–38) select to include line descriptions so the requester list can show item name + count:
```ts
async function listRequests(): Promise<RequestRow[]> {
  return (ok(await db().from(TABLES.requests)
    .select('*, line_items(item_description)')
    .order('updated_at', { ascending: false })) ?? []) as RequestRow[]
}
```
Add an optional field to `RequestRow`: `line_items?: { item_description: string | null }[]`.

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: build succeeds (no TS errors). (No unit test — these are I/O bindings.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/constants.ts src/data/db.ts
git commit -m "feat(procurement): data layer — cancelled status, numbering fields, cancelLineItem"
```

---

## Task 5: Item Name relabel (requester form)

**Files:**
- Modify: `src/requester/LineItemFormRow.tsx`

**Interfaces:** No new exports. `LineItemDraft.item_description` still stores the value (now labeled "Item Name").

- [ ] **Step 1: Relabel and switch to a single-line input**

In `src/requester/LineItemFormRow.tsx`, replace the Item Description block (lines ~188–196):
```tsx
{/* Item Name (stored as item_description) */}
<Field label="Item Name" error={errors.item_description}>
  <input
    type="text"
    value={value.item_description}
    onChange={(e) => set({ item_description: e.target.value })}
    placeholder="e.g. Dell 27&quot; Monitor"
    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
  />
</Field>
```
(Leave the Memo field unchanged.)

- [ ] **Step 2: Ensure Item Name is required**

Open the parent form validation (search `item_description` in `src/requester/NewRequestForm.tsx`). If it is not already required, add a trimmed-empty check that sets `errors.item_description = 'Item name is required'` before submit. If it is already validated, no change.

- [ ] **Step 3: Verify build + manual render**

Run: `npm run build`
Expected: success. (Visual check happens in the Task 11 local-dev run.)

- [ ] **Step 4: Commit**

```bash
git add src/requester/LineItemFormRow.tsx src/requester/NewRequestForm.tsx
git commit -m "feat(procurement): relabel Item Description -> Item Name (single-line, required)"
```

---

## Task 6: Requester Requests list — numbering + status tabs

**Files:**
- Modify: `src/requester/RequestsList.tsx`

**Interfaces:**
- Consumes: `formatRequestNo` (Task 1); `countByStatus`/`filterByStatus` (Task 1); `RequestRow.request_number` + `line_items` (Task 4); `REQUEST_STATUS` incl. `cancelled` (Task 4).

- [ ] **Step 1: Add imports + tab state**

At the top of `src/requester/RequestsList.tsx` add imports:
```tsx
import { PERMS, formatDate, REQUEST_STATUS } from '../lib/constants'
import { formatRequestNo } from '../lib/itemRef'
import { countByStatus, filterByStatus } from '../lib/requestFilter'
```
Inside the component, after the `requests` state:
```tsx
const [tab, setTab] = useState<string>('all')
const counts = countByStatus(requests)
const visible = filterByStatus(requests, tab)
const TABS = ['all', ...REQUEST_STATUS] as const
```

- [ ] **Step 2: Render the tab bar**

Immediately after the "My Requests" header `<div>...</div>` (before the empty-state check), insert:
```tsx
<div className="flex flex-wrap gap-1 border-b border-border">
  {TABS.map((t) => (
    <button
      key={t}
      type="button"
      onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs font-medium capitalize border-b-2 -mb-px transition-colors ${
        tab === t
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {t.replace(/_/g, ' ')} {counts[t] ? `(${counts[t]})` : '(0)'}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Drive the list off `visible` and show the request number + item name**

- Change the list map source from `requests.map` to `visible.map`.
- Change the empty-state condition from `requests.length === 0` to `visible.length === 0`, and its copy to: `No requests in this view.`
- Replace the row title `<span>` (currently `req.notes ? ... : 'No notes'`) with:
```tsx
<span className="text-sm font-medium text-foreground">
  {formatRequestNo(req.request_number)}
  {' · '}
  {(() => {
    const items = req.line_items ?? []
    const first = items[0]?.item_description?.trim()
    if (!first) return req.notes?.trim() || 'Untitled request'
    return items.length > 1 ? `${first} (+${items.length - 1} more)` : first
  })()}
</span>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/requester/RequestsList.tsx
git commit -m "feat(procurement): requester list — request # + item name + status tabs/counts"
```

---

## Task 7: Item references in approver/purchaser/requester detail views

**Files:**
- Modify: `src/requester/RequestDetail.tsx`
- Modify: `src/pages/ApprovalsPage.tsx`
- Modify: `src/pages/PurchasingPage.tsx`
- Modify: `src/pages/ReturnsPage.tsx`

**Interfaces:** Consumes `formatItemRef` (Task 1), `request_number` (Task 4), `line_no` (Task 4).

- [ ] **Step 1: Approvals label**

In `src/pages/ApprovalsPage.tsx`, add import `import { formatItemRef } from '../lib/itemRef'` and replace the item name `<p>` (lines ~101–103):
```tsx
<p className="text-sm font-medium text-foreground">
  {formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}
</p>
```

- [ ] **Step 2: Purchasing label**

In `src/pages/PurchasingPage.tsx`, add the same import and replace the item label (lines ~129–131) with:
```tsx
<p className="text-sm font-medium text-foreground">
  {formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}
</p>
```

- [ ] **Step 3: Returns label**

In `src/pages/ReturnsPage.tsx`, add the import and apply the same `formatItemRef(item.request?.request_number, item.line_no) — {item.item_description || 'Unnamed item'}` pattern to its item title element (search for `item_description` in that file).

- [ ] **Step 4: Request detail header**

In `src/requester/RequestDetail.tsx`, add the import and update the per-item header (search `Item #` / `item_description`, ~line 107) to:
```tsx
{formatItemRef(request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}
```
(Use whatever the loaded request variable is named in this file for `request_number`; if the detail loader doesn't select `request_number`, add it to that select.)

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/requester/RequestDetail.tsx src/pages/ApprovalsPage.tsx src/pages/PurchasingPage.tsx src/pages/ReturnsPage.tsx
git commit -m "feat(procurement): show #req-line — item name across item views"
```

---

## Task 8: Cancel button on Purchasing (+ notification)

**Files:**
- Modify: `src/pages/PurchasingPage.tsx`
- Modify: `app.manifest.json` (add `item_cancelled` notification)

**Interfaces:** Consumes `api.cancelLineItem` (Task 4), `api.fireNotification` (existing). Item rows come from `listLineItemsByStatus(['approved'])`.

- [ ] **Step 1: Declare the notification key in the manifest**

In `app.manifest.json` `notifications` array, add (keep `sort_order` unique):
```json
{ "key": "item_cancelled", "label": "Item cancelled", "description": "An approved item was cancelled; a new request is needed.", "sort_order": 6 }
```

- [ ] **Step 2: Add the cancel handler**

In `src/pages/PurchasingPage.tsx`, add a handler near `handleSubmit`:
```tsx
async function handleCancel(item: LineItemWithRequest) {
  if (!window.confirm('Cancel this approved item? The requester will need to submit a new request.')) return
  setSubmittingId(item.id)
  try {
    await api.cancelLineItem(item.id)
    await api.fireNotification('item_cancelled')
    showToast({ message: 'Item cancelled', type: 'success' })
    await load()
  } catch (err: unknown) {
    showToast({ message: err instanceof Error ? err.message : 'Failed to cancel item', type: 'error' })
  } finally {
    setSubmittingId(null)
  }
}
```

- [ ] **Step 3: Render the Cancel button beside "Place Order"**

In the row action area (next to the existing `Place Order` button, ~lines 176–184), add — only when the order form is closed:
```tsx
{!isOpen && (
  <button
    type="button"
    disabled={submittingId === item.id}
    onClick={() => handleCancel(item)}
    className="self-start inline-flex items-center rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
  >
    Cancel
  </button>
)}
```
(Match the existing local variable used for "form open" — `isOpen`/`openFormId === item.id` — as in the surrounding code.)

- [ ] **Step 4: Validate + build**

Run: `npm run validate && npm run build`
Expected: manifest validates (notification listed), build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PurchasingPage.tsx app.manifest.json
git commit -m "feat(procurement): cancel approved item from Purchasing + item_cancelled notify"
```

---

## Task 9: Migration 012 — replacement returns re-enter Purchasing

**Files:**
- Create: `migrations/012_replacement_routing.sql`
- Modify: `app.manifest.json`
- Modify: `src/pages/PurchasingPage.tsx` (Replacement tag)

**Interfaces:**
- Produces: `initiate_return` now sets `status='approved'` when `p_wants_replacement`, else `'returned'`; existing `replacement_ordered` rows migrated to `approved`. A replacement re-purchase is identified in the UI by `return_date != null && wants_replacement`.

- [ ] **Step 1: Write the migration**

`migrations/012_replacement_routing.sql`:
```sql
-- 012: Phase 4 QA — a return that wants a replacement routes back to 'approved' so it
-- reappears in the Purchasing queue (order_line_item accepts 'approved'). No-replacement
-- returns stay terminal 'returned'. Backfill existing stuck 'replacement_ordered' rows.
UPDATE app_procurement.line_items SET status='approved', updated_at=now() WHERE status='replacement_ordered';
CREATE OR REPLACE FUNCTION app_procurement.initiate_return(p_line_item_id uuid, p_return_quantity int, p_return_reason text, p_has_packaging boolean, p_wants_replacement boolean, p_return_notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_owner uuid; v_req uuid; BEGIN SELECT pr.requester_id, pr.id INTO v_owner, v_req FROM app_procurement.line_items li JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id WHERE li.id = p_line_item_id; IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN RAISE EXCEPTION 'Only the requester or an admin can initiate a return'; END IF; UPDATE app_procurement.line_items SET status = CASE WHEN p_wants_replacement THEN 'approved' ELSE 'returned' END, return_quantity=p_return_quantity, return_reason=p_return_reason, has_packaging=p_has_packaging, wants_replacement=p_wants_replacement, return_notes=p_return_notes, return_date=now(), updated_at=now() WHERE id=p_line_item_id AND status='received'; IF v_req IS NOT NULL THEN PERFORM internal.proc_recompute_request_status(v_req); END IF; END; $fn$;
```

- [ ] **Step 2: Register in manifest**

Append to `database.migrations`:
```json
{ "file": "migrations/012_replacement_routing.sql", "description": "Phase 4 QA: replacement returns route to approved (Purchasing); backfill replacement_ordered" }
```

- [ ] **Step 3: Add a "Replacement" tag in Purchasing**

In `src/pages/PurchasingPage.tsx`, in the item header area (near the `formatItemRef` label from Task 7), add a tag when the approved item is a replacement re-purchase:
```tsx
{item.return_date && item.wants_replacement && (
  <span className="inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 text-xs font-medium text-info">
    Replacement
  </span>
)}
```
(Ensure `return_date` and `wants_replacement` exist on the `LineItemRow`/`LineItemWithRequest` type; they are columns from migration 001 so `select('*')` already returns them — add to the interface if TS complains.)

- [ ] **Step 4: Validate + build**

Run: `npm run validate && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add migrations/012_replacement_routing.sql app.manifest.json src/pages/PurchasingPage.tsx
git commit -m "feat(procurement): migration 012 — replacement returns re-enter Purchasing"
```

---

## Task 10: Admin-initiated returns on Records

**Files:**
- Modify: `src/records/RecordsPage.tsx`

**Interfaces:** Consumes existing `ReturnForm` (`src/requester/ReturnForm.tsx`) and `api.initiateReturn` (admin already permitted by the RPC). Rows are `LineItemDetailed` (has `id`, `quantity`, `status`).

- [ ] **Step 1: Import ReturnForm + add expand state**

In `src/records/RecordsPage.tsx` add `import { ReturnForm } from '../requester/ReturnForm'` and a state near `busyId`:
```tsx
const [returnOpenId, setReturnOpenId] = useState<string | null>(null)
```

- [ ] **Step 2: Add a "Return" action for received items**

In the Actions `<td>` (where Delete renders, ~lines 231–242), for received items add before/after the Delete button (gate on the returns or admin permission — reuse `canComment` which already covers approve|purchase|admin, or add `const canReturn = hasPermission(PERMS.returns) || hasPermission(PERMS.admin)`):
```tsx
{item.status === 'received' && (
  <button
    type="button"
    onClick={() => setReturnOpenId(returnOpenId === item.id ? null : item.id)}
    className="inline-flex items-center rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
  >
    Return
  </button>
)}
```

- [ ] **Step 3: Render an expanded ReturnForm row**

Directly after the item's `<tr>...</tr>`, add a conditional full-width row:
```tsx
{returnOpenId === item.id && (
  <tr>
    <td colSpan={COLSPAN} className="bg-muted/30 p-4">
      <ReturnForm
        item={item as unknown as LineItemWithRequest}
        onDone={async () => { setReturnOpenId(null); await load() }}
      />
    </td>
  </tr>
)}
```
Set `COLSPAN` to the table's column count (count the `<th>` cells in the header row, including the conditional Actions column). Import `LineItemWithRequest` from `../data/db` if not already imported.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/records/RecordsPage.tsx
git commit -m "feat(procurement): admin can initiate a return from Records"
```

---

## Task 11: Formatting-rule clarification + version bump + package

**Files:**
- Modify: `src/pages/AdminPage.tsx`
- Modify: `app.manifest.json` (version)

**Interfaces:** None.

- [ ] **Step 1: Clarify the formatting card copy**

In `src/pages/AdminPage.tsx` `FormattingRulesCard` (intro `<p>`, ~lines 435–437), append a second sentence to the existing paragraph or add a new `<p>` after it:
```tsx
<p className="text-sm text-muted-foreground">
  Formatting rules only color rows — they do not create new statuses. The status list is fixed.
</p>
```

- [ ] **Step 2: Bump the app version**

In `app.manifest.json`, change `"version": "0.7.1"` → `"version": "0.8.0"`.

- [ ] **Step 3: Full verification**

Run: `npm run validate && npm test && npm run build`
Expected: manifest valid, tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminPage.tsx app.manifest.json
git commit -m "chore(procurement): formatting-rule note + bump to v0.8.0"
```

- [ ] **Step 5: Package the app bundle**

Run: `npm run package`
Expected: a `dist/*.eitapp` bundle is produced for the Admin UI upload.

---

## Post-implementation

- Run the app in the local test-shell (`npm run local-dev`) and walk each flow: submit a multi-item request (see `#N` + Item Name), open the requester tabs (counts), approve then cancel from Purchasing, receive an item then request a return with replacement and confirm it appears back in Purchasing.
- Push the feature branch, merge/push to `for-qa`, and hand to Gevenlie for QA. Do not merge to `main` until she signs off.
- Reply to Gevenlie on ClickUp `86exz0ujv` explaining: the formatting-rule vs status distinction (#6), and the new returns flow (#5).

## Notes / deliberate scope decisions

- **RPC pattern:** follows the real repo convention (single `SECURITY DEFINER` in `app_procurement`), not the public-wrapper/internal-definer split CLAUDE.md describes. Flag for Jerome whether to reconcile CLAUDE.md.
- **`replacement_ordered` status** becomes dormant (kept in the enum for backward-compat; existing rows migrated to `approved`). `process_return`'s replacement branch is now unused by the UI — a future cleanup, out of scope here.
- **ReturnsPage** now surfaces only non-replacement `returned` records; replacements go straight to Purchasing.
