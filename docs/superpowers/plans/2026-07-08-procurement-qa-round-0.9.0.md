# Procurement QA Round 0.9.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three QA follow-ups as v0.9.0 — full-width dashboard KPI cards + three brand-themed charts, and a Purchase Order system for the Purchasing page (Ready for Purchasing / Open Orders / Closed Orders). The Requests page needs no change (already requester-scoped via RLS).

**Architecture:** Two independent phases, each independently shippable/testable. **Phase 1** (Dashboard) is frontend-only: a pure, unit-tested aggregation module feeds ui-kit `Chart` components; a CSS grid makes cards fill the row. **Phase 2** (Purchasing) is full-stack: a new `purchase_orders` table + `SECURITY DEFINER` RPCs (following the existing `app_procurement` RPC pattern), new data-layer methods, and a refactor of `PurchasingPage` into three sub-tabs. Both per-item quick-order and multi-select PO creation coexist.

**Tech Stack:** React 19 + TypeScript + Vite (library build, ESM), Tailwind v4 semantic tokens, `@elasticit-llc/ui-kit` v0.5.4 (`Chart` = Recharts wrapper), `recharts` (bundled), Supabase Postgres (schema `app_procurement`, RLS), vitest + jsdom.

## Global Constraints

- **App version:** bump `app.manifest.json` `version` `0.8.0` → `0.9.0` (minor; manifest is authoritative). `package.json` version may lag.
- **New migration is `014`** — `013_return_processed.sql` is the current highest. Never edit an applied migration; add a new numbered file and register it in the manifest.
- **RPC pattern (this repo's actual convention):** define callable RPCs directly in schema `app_procurement` as `LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public`; gate with `IF NOT public.check_user_permission(auth.uid(), '<key>') THEN RAISE EXCEPTION ...`; then `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` + `GRANT EXECUTE ON FUNCTION ... TO authenticated, service_role;` (full arg-type signature required).
- **Permission keys:** purchasing = `apps/procurement/purchasing/manage`; admin = `apps/procurement/admin/manage`.
- **RLS:** read policies are `FOR SELECT TO authenticated USING (...)`, written DROP-then-CREATE for idempotency. Writes go through the DEFINER RPCs.
- **No hardcoded colors** — use semantic Tailwind tokens (`bg-card`, `text-foreground`, `border-border`, `bg-primary`, etc.). ui-kit `Chart` auto-themes via `brand-*` tokens.
- **`recharts` is bundled** (not externalized) — `vite.config.ts` externals stay unchanged; it already carries the recharts CJS workarounds.
- **Test surface:** the repo's vitest harness covers **pure TypeScript only** (e.g. `src/lib/requestFilter.test.ts`). Apply TDD to pure functions. Components and SQL are verified by typecheck/build and manual/DB exercise (documented per task) — there is no React/DB test harness to add here.
- **Feature-folder convention:** feature code lives in `src/<feature>/` (`src/requester/`, `src/records/`, `src/formatting/`). New dashboard/purchasing modules follow this.

---

# Phase 1 — Dashboard (frontend-only)

## Task 1: KPI cards fill the row (responsive grid)

**Files:**
- Modify: `src/pages/DashboardPage.tsx:16` (KpiCard width) and `:94` (container)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks (pure layout change).

- [ ] **Step 1: Change the KpiCard width from fixed to full**

In `src/pages/DashboardPage.tsx`, the `KpiCard` root `div` (line 16) currently is:
```tsx
<div className="rounded-lg border border-border bg-card px-4 py-3 w-44">
```
Change `w-44` → `w-full`:
```tsx
<div className="rounded-lg border border-border bg-card px-4 py-3 w-full">
```

- [ ] **Step 2: Change the KPI container from wrapping flex to a responsive grid**

The KPI container (line 94) currently is:
```tsx
<div className="flex flex-wrap gap-3">
```
Change to a responsive grid so cards stretch to fill each row:
```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
```

- [ ] **Step 3: Verify typecheck + build pass**

Run: `npm run build`
Expected: build succeeds (tsc emit + vite build, no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/pages/DashboardPage.tsx
git commit -m "feat(procurement): dashboard KPI cards fill the row (responsive grid)"
```

---

## Task 2: Dashboard aggregation module (pure, TDD)

**Files:**
- Create: `src/dashboard/stats.ts`
- Test: `src/dashboard/stats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 3):
  - `interface StatusCount { status: string; count: number }`
  - `interface MonthCount { month: string; count: number }`
  - `countByStatusList<T extends { status: string }>(rows: T[], order: readonly string[]): StatusCount[]`
  - `requestsByMonth<T extends { submitted_at: string }>(rows: T[]): MonthCount[]`

- [ ] **Step 1: Write the failing tests**

Create `src/dashboard/stats.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { countByStatusList, requestsByMonth } from './stats'

const items = [
  { status: 'approved' },
  { status: 'approved' },
  { status: 'pending' },
  { status: 'weird_status' },
]

describe('countByStatusList', () => {
  it('counts per status, ordered by the given canonical order, extras last', () => {
    expect(countByStatusList(items, ['pending', 'approved'])).toEqual([
      { status: 'pending', count: 1 },
      { status: 'approved', count: 2 },
      { status: 'weird_status', count: 1 },
    ])
  })
  it('omits statuses that never appear', () => {
    expect(countByStatusList([{ status: 'pending' }], ['pending', 'approved'])).toEqual([
      { status: 'pending', count: 1 },
    ])
  })
  it('handles empty input', () => expect(countByStatusList([], ['pending'])).toEqual([]))
})

describe('requestsByMonth', () => {
  it('groups by YYYY-MM ascending', () => {
    const rows = [
      { submitted_at: '2026-07-08T10:00:00Z' },
      { submitted_at: '2026-07-20T10:00:00Z' },
      { submitted_at: '2026-05-01T10:00:00Z' },
    ]
    expect(requestsByMonth(rows)).toEqual([
      { month: '2026-05', count: 1 },
      { month: '2026-07', count: 2 },
    ])
  })
  it('handles empty input', () => expect(requestsByMonth([])).toEqual([]))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/dashboard/stats.test.ts`
Expected: FAIL — cannot resolve `./stats` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/dashboard/stats.ts`:
```ts
export interface StatusCount { status: string; count: number }
export interface MonthCount { month: string; count: number }

/**
 * Count rows per status, returned as a chart-friendly array. Statuses are ordered by the
 * canonical `order` list (so charts are stable); any status not in `order` is appended last.
 * Statuses that never appear are omitted.
 */
export function countByStatusList<T extends { status: string }>(rows: T[], order: readonly string[]): StatusCount[] {
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  const ordered = order.filter(s => counts[s] !== undefined).map(s => ({ status: s, count: counts[s] }))
  const extras = Object.keys(counts).filter(s => !order.includes(s)).map(s => ({ status: s, count: counts[s] }))
  return [...ordered, ...extras]
}

/**
 * Group rows into monthly counts keyed by `YYYY-MM` (sliced from the ISO `submitted_at`
 * string — no Date parsing, so timezone-safe for grouping), sorted ascending.
 */
export function requestsByMonth<T extends { submitted_at: string }>(rows: T[]): MonthCount[] {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const month = r.submitted_at.slice(0, 7)
    counts[month] = (counts[month] ?? 0) + 1
  }
  return Object.keys(counts).sort().map(month => ({ month, count: counts[month] }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/dashboard/stats.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/stats.ts src/dashboard/stats.test.ts
git commit -m "feat(procurement): dashboard stats aggregation helpers (pure + tested)"
```

---

## Task 3: Dashboard charts (ui-kit Chart + recharts dependency)

**Files:**
- Modify: `package.json` (add `dependencies` with `recharts`)
- Modify: `src/data/db.ts` (add `listLineItemStatuses`)
- Modify: `src/pages/DashboardPage.tsx` (fetch statuses, render 3 charts)

**Interfaces:**
- Consumes: `countByStatusList`, `requestsByMonth` (Task 2); `Chart` from `@elasticit-llc/ui-kit`; `LINE_ITEM_STATUS`, `REQUEST_STATUS` from `src/lib/constants.ts`.
- Produces: `listLineItemStatuses(): Promise<{ status: string }[]>` on the `useProcurementApi()` hook (used only here).

- [ ] **Step 1: Declare `recharts` as an explicit dependency**

`recharts@3.8.1` currently resolves only transitively (it is a peer dep of ui-kit). Make it explicit and reproducible. In `package.json`, add a `dependencies` block (there is none today) between `"private": true,` and `"scripts"`:
```json
  "dependencies": {
    "recharts": "^3.8.1"
  },
```

- [ ] **Step 2: Verify the dependency resolves and build still works**

Run: `npm install`
Then: `node -e "console.log(require('./node_modules/recharts/package.json').version)"`
Expected: prints `3.8.1` (or a compatible ^3 version).

- [ ] **Step 3: Add a thin `listLineItemStatuses` query to the data layer**

In `src/data/db.ts`, add this function inside `useProcurementApi()` (next to `countLineItems`, around line 122):
```ts
  // Thin status-only read for the dashboard "Items by Status" chart. RLS-scoped
  // (all items for an admin, own items for a requester). Capped at 1000 rows by
  // PostgREST — acceptable for the dashboard; TODO: move to a grouped-count RPC if volume grows.
  async function listLineItemStatuses(): Promise<{ status: string }[]> {
    return (ok(await db().from(TABLES.lineItems).select('status')) ?? []) as { status: string }[]
  }
```
Then add `listLineItemStatuses` to the returned object at the end of the hook (the `return { ... }` on line 197):
```ts
  return { listRequests, getRequest, listLineItems, listLocations, listDepartments, listAllLocations, listAllDepartments, submitRequest, decideLineItem, orderLineItem, receiveLineItem, initiateReturn, processReturn, cancelLineItem, listLineItemsByStatus, listLineItemStatuses, listAllLineItemsDetailed, countLineItems, setLineItemComment, deleteLineItem, createLocation, createDepartment, updateLocation, updateDepartment, fireNotification, captureAndNotify, getProductImageUrl, notifyApproved, resolveUserNames, getFormattingRules, setFormattingRules, listShipToWorkers }
```

- [ ] **Step 4: Import Chart, constants, and stats into DashboardPage**

In `src/pages/DashboardPage.tsx`, update the imports (lines 1-6). Add the `Chart` import and extend the constants + stats imports:
```tsx
import { useState, useEffect, useCallback } from 'react'
import { useShellContext } from '@elasticit-llc/app-bridge'
import { usePermissions } from '@elasticit-llc/app-bridge'
import { Chart } from '@elasticit-llc/ui-kit'
import { useProcurementApi, RequestRow, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { PERMS, formatDate, REQUEST_STATUS, LINE_ITEM_STATUS } from '../lib/constants'
import { countByStatusList, requestsByMonth } from '../dashboard/stats'
```

- [ ] **Step 5: Fetch line-item statuses in `load()`**

Add a state field (near line 34, with the other `useState`s):
```tsx
  const [itemStatuses, setItemStatuses] = useState<{ status: string }[]>([])
```
In `load()`, add the fetch to the initial `fetches` array (line 45) so it always runs:
```tsx
      const fetches: Promise<unknown>[] = [api.listRequests(), api.countLineItems(), api.listLineItemStatuses()]
```
Then update the destructure + assignment (lines 51-53). Because `listLineItemStatuses` is the 3rd fixed fetch, pull it out before the permission-gated `rest`:
```tsx
      const [reqs, itemCount, statuses, ...rest] = await Promise.all(fetches)
      setRequests(reqs as RequestRow[])
      setTotalItems(itemCount as number)
      setItemStatuses(statuses as { status: string }[])
```
(The `let idx = 0` block and the `canApprove/canPurchase/canReturns` assignments that follow stay exactly as-is — `rest` still holds only the permission-gated results in the same order.)

- [ ] **Step 6: Compute chart datasets and render the charts**

Just below `const recentItems = requests.slice(0, 5)` (line 69), add:
```tsx
  const reqStatusData = countByStatusList(requests, REQUEST_STATUS)
  const itemStatusData = countByStatusList(itemStatuses, LINE_ITEM_STATUS)
  const reqMonthData = requestsByMonth(requests)
```
Then, inside the `{!loading && !error && ( <> ... </> )}` block, insert a charts section **between** the KPI grid `</div>` (closes at line 118) and the `{/* Recent activity */}` block (line 120):
```tsx
          {/* Charts */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests by Status</h3>
              <Chart type="pie" data={reqStatusData} xKey="status" yKey="count" height={240} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Items by Status</h3>
              <Chart type="bar" data={itemStatusData} xKey="status" yKey="count" height={240} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests Over Time</h3>
              <Chart type="area" data={reqMonthData} xKey="month" yKey="count" height={240} />
            </div>
          </div>
```

- [ ] **Step 7: Verify build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Manually verify in the local test-shell**

Run: `npm run local-dev`
Open the shell, go to Procurement → Dashboard. Confirm: KPI cards stretch to fill the row; three charts render in the client brand palette (bar/pie/area); no console errors about `recharts`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/data/db.ts src/pages/DashboardPage.tsx
git commit -m "feat(procurement): dashboard charts (requests/items by status, requests over time) via ui-kit Chart"
```

---

# Phase 2 — Purchasing: Purchase Orders

## Task 4: Migration 014 — purchase_orders table, RPCs, auto-close

**Files:**
- Create: `migrations/014_purchase_orders.sql`
- Modify: `app.manifest.json` (`database.migrations` array — add version 14 entry)

**Interfaces:**
- Consumes: existing `internal.proc_recompute_request_status(uuid)`, `public.check_user_permission(uuid, text)`, `app_procurement.locations`, `app_procurement.line_items`, `app_procurement.purchase_requests`.
- Produces (used by Task 5): table `app_procurement.purchase_orders`, column `line_items.po_id`, RPCs `create_purchase_order(uuid[], text, date, date, uuid, text, text) RETURNS purchase_orders`, `close_purchase_order(uuid) RETURNS void`; modified `receive_line_item(uuid)` with PO auto-close + purchaser-allowed receiving.

- [ ] **Step 1: Write the migration file**

Create `migrations/014_purchase_orders.sql` (dense single-line RPC style matches `002`/`013`):
```sql
-- 014: Phase 5 — Purchase Orders. Group approved line items into a PO with an open/closed lifecycle.
-- POs are created/closed via SECURITY DEFINER RPCs (purchasing perm). receive_line_item now auto-closes a PO once its last item is received, and purchasers may mark items received. RLS: purchasers/admins read POs; writes go through the RPCs.

-- Sequence for the numeric part of the human PO number (globally unique; the year in the label is display only).
CREATE SEQUENCE IF NOT EXISTS app_procurement.purchase_order_seq;

CREATE TABLE IF NOT EXISTS app_procurement.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE,
  vendor TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by UUID,
  date_purchased DATE, eta DATE,
  shipping_location_id UUID REFERENCES app_procurement.locations (id), custom_shipping_location TEXT,
  notes TEXT, closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON app_procurement.purchase_orders (status);

ALTER TABLE app_procurement.line_items ADD COLUMN IF NOT EXISTS po_id UUID REFERENCES app_procurement.purchase_orders (id);
CREATE INDEX IF NOT EXISTS line_items_po_idx ON app_procurement.line_items (po_id);

-- RLS: purchasers/admins may read POs (the Purchasing page is permission-gated; requesters don't query POs).
ALTER TABLE app_procurement.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_procurement_purchase_orders_read ON app_procurement.purchase_orders;
CREATE POLICY app_procurement_purchase_orders_read ON app_procurement.purchase_orders FOR SELECT TO authenticated USING (public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));

-- create_purchase_order: group approved items into a new open PO, flip them to 'ordered', copy purchase details.
CREATE OR REPLACE FUNCTION app_procurement.create_purchase_order(p_line_item_ids uuid[], p_vendor text, p_date_purchased date, p_eta date, p_shipping_location_id uuid, p_custom_shipping_location text, p_notes text) RETURNS app_procurement.purchase_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_po app_procurement.purchase_orders; v_num text; v_count int; v_req uuid; BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN RAISE EXCEPTION 'Not permitted to purchase'; END IF; IF p_line_item_ids IS NULL OR array_length(p_line_item_ids, 1) IS NULL THEN RAISE EXCEPTION 'No line items provided'; END IF; SELECT count(*) INTO v_count FROM app_procurement.line_items WHERE id = ANY(p_line_item_ids) AND status='approved'; IF v_count <> array_length(p_line_item_ids, 1) THEN RAISE EXCEPTION 'All items must be approved'; END IF; v_num := 'PO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('app_procurement.purchase_order_seq')::text, 4, '0'); INSERT INTO app_procurement.purchase_orders (po_number, vendor, status, created_by, date_purchased, eta, shipping_location_id, custom_shipping_location, notes) VALUES (v_num, nullif(p_vendor,''), 'open', auth.uid(), coalesce(p_date_purchased, current_date), p_eta, p_shipping_location_id, nullif(p_custom_shipping_location,''), nullif(p_notes,'')) RETURNING * INTO v_po; UPDATE app_procurement.line_items SET status='ordered', po_id=v_po.id, date_purchased=coalesce(p_date_purchased, current_date), eta=p_eta, shipping_location_id=p_shipping_location_id, custom_shipping_location=p_custom_shipping_location, purchase_notes=p_notes, updated_at=now() WHERE id = ANY(p_line_item_ids) AND status='approved'; FOR v_req IN SELECT DISTINCT request_id FROM app_procurement.line_items WHERE id = ANY(p_line_item_ids) LOOP PERFORM internal.proc_recompute_request_status(v_req); END LOOP; RETURN v_po; END; $fn$;

-- close_purchase_order: manual close (supports partial/early closure).
CREATE OR REPLACE FUNCTION app_procurement.close_purchase_order(p_po_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN RAISE EXCEPTION 'Not permitted to purchase'; END IF; UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=p_po_id AND status='open'; END; $fn$;

-- receive_line_item (REPLACES 002 version): requester/admin/purchaser marks an ordered item received; auto-closes the PO once its last item is received.
CREATE OR REPLACE FUNCTION app_procurement.receive_line_item(p_line_item_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_owner uuid; v_po uuid; v_remaining int; BEGIN SELECT pr.requester_id, li.po_id INTO v_owner, v_po FROM app_procurement.line_items li JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id WHERE li.id = p_line_item_id; IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN RAISE EXCEPTION 'Not permitted to mark received'; END IF; UPDATE app_procurement.line_items SET status='received', updated_at=now() WHERE id=p_line_item_id AND status='ordered'; IF v_po IS NOT NULL THEN SELECT count(*) INTO v_remaining FROM app_procurement.line_items WHERE po_id=v_po AND status <> 'received'; IF v_remaining = 0 THEN UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=v_po AND status='open'; END IF; END IF; END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.create_purchase_order(uuid[], text, date, date, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.create_purchase_order(uuid[], text, date, date, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app_procurement.close_purchase_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.close_purchase_order(uuid) TO authenticated, service_role;
```
> Note: `receive_line_item`'s existing grants (from `002`) survive `CREATE OR REPLACE`, so they are not repeated. `create_purchase_order` uses `RETURNS app_procurement.purchase_orders` so the client receives the full new PO row (incl. `po_number`).

- [ ] **Step 2: Register the migration in the manifest**

In `app.manifest.json`, append to the `database.migrations` array (after the version-13 entry, keeping valid JSON — add a comma to the current last line):
```json
      { "version": 14, "description": "Phase 5: Purchase Orders (purchase_orders table + create/close RPCs + receive auto-close)", "up": "migrations/014_purchase_orders.sql" }
```

- [ ] **Step 3: Validate the manifest/source contract**

Run: `npm run validate`
Expected: "no issues found" (migration file referenced by the manifest exists and is numbered correctly).

- [ ] **Step 4: Apply + exercise the migration against a Supabase dev branch**

Apply `migrations/014_purchase_orders.sql` to a Supabase **dev branch** (via the Supabase MCP `apply_migration`, or `supabase db push` against a non-production branch — never production). Then exercise it with SQL (`execute_sql` on the branch), impersonating a purchaser context as your setup allows:
```sql
-- Preconditions: at least 2 line_items in status 'approved' (ids :a, :b).
-- 1. Create a PO from two approved items:
SELECT * FROM app_procurement.create_purchase_order(ARRAY[:'a', :'b']::uuid[], 'CDW', current_date, NULL, NULL, NULL, 'test PO');
--    Expect: one row, po_number like 'PO-2026-0001', status 'open'.
-- 2. Both items now ordered + linked:
SELECT id, status, po_id FROM app_procurement.line_items WHERE id IN (:'a', :'b');
--    Expect: status 'ordered', po_id = the new PO id for both.
-- 3. Receive the first item — PO stays open (one item remains):
SELECT app_procurement.receive_line_item(:'a');
SELECT status FROM app_procurement.purchase_orders WHERE po_number = 'PO-2026-0001';  -- Expect 'open'
-- 4. Receive the second — PO auto-closes:
SELECT app_procurement.receive_line_item(:'b');
SELECT status, closed_at FROM app_procurement.purchase_orders WHERE po_number = 'PO-2026-0001';  -- Expect 'closed', closed_at set
```
Also confirm an authenticated purchaser can `SELECT` from `app_procurement.purchase_orders` through PostgREST/the app. **If PostgREST returns a permission error**, the framework did not auto-grant table access — add `GRANT SELECT ON app_procurement.purchase_orders TO authenticated;` to the migration and re-apply. (Existing tables get grants from the app framework, so this is expected to be unnecessary — verify, don't assume.)

- [ ] **Step 5: Commit**

```bash
git add migrations/014_purchase_orders.sql app.manifest.json
git commit -m "feat(procurement): migration 014 — purchase_orders table, create/close RPCs, receive auto-close"
```

---

## Task 5: Data layer — PO methods + `po_id` on line items

**Files:**
- Modify: `src/data/db.ts`

**Interfaces:**
- Consumes: RPCs from Task 4.
- Produces (used by Tasks 6-9):
  - `LineItemRow` gains `po_id: string | null`.
  - `interface PurchaseOrderRow { id; po_number; vendor; status: 'open'|'closed'; created_by; date_purchased; eta; shipping_location_id; custom_shipping_location; notes; closed_at; created_at; line_items: LineItemWithRequest[] }`
  - `createPurchaseOrder(lineItemIds: string[], f: { vendor?; date_purchased?; eta?; shipping_location_id?; custom_shipping_location?; notes? }): Promise<{ id: string; po_number: string }>`
  - `listPurchaseOrders(status: 'open' | 'closed'): Promise<PurchaseOrderRow[]>`
  - `closePurchaseOrder(id: string): Promise<void>`

- [ ] **Step 1: Add `po_id` to the `LineItemRow` interface**

In `src/data/db.ts`, the `LineItemRow` interface (line 10) ends with `... created_at: string; line_no: number | null; return_processed_at: string | null }`. Add `po_id`:
```ts
export interface LineItemRow { id: string; request_id: string; item_description: string | null; item_url: string | null; memo: string | null; quantity: number; status: LineItemStatus; location_id: string | null; custom_location: string | null; department_id: string | null; custom_department: string | null; date_needed: string | null; eta: string | null; admin_comment: string | null; commented_by: string | null; commented_at: string | null; product_image_path: string | null; return_reason: string | null; return_quantity: number | null; wants_replacement: boolean | null; return_notes: string | null; return_date: string | null; created_at: string; line_no: number | null; return_processed_at: string | null; po_id: string | null }
```

- [ ] **Step 2: Add the `PurchaseOrderRow` interface**

After the `LineItemWithRequest` interface (ends line 20), add:
```ts
export interface PurchaseOrderRow {
  id: string
  po_number: string
  vendor: string | null
  status: 'open' | 'closed'
  created_by: string | null
  date_purchased: string | null
  eta: string | null
  shipping_location_id: string | null
  custom_shipping_location: string | null
  notes: string | null
  closed_at: string | null
  created_at: string
  line_items: LineItemWithRequest[]
}
```

- [ ] **Step 3: Register the new RPC names**

In the `RPCS` map (line 7), add three entries (keep the existing ones):
```ts
const RPCS = { submit: 'submit_request', decide: 'decide_line_item', order: 'order_line_item', receive: 'receive_line_item', initiateReturn: 'initiate_return', processReturn: 'process_return', setComment: 'set_line_item_comment', deleteItem: 'delete_line_item', cancel: 'cancel_line_item', getUserNames: 'get_user_names', getFormattingRules: 'get_formatting_rules', createPO: 'create_purchase_order', closePO: 'close_purchase_order' } as const
```
Add a `TABLES` entry for the new table (line 6):
```ts
const TABLES = { requests: 'purchase_requests', lineItems: 'line_items', locations: 'locations', departments: 'departments', config: '_config', purchaseOrders: 'purchase_orders' } as const
```

- [ ] **Step 4: Add the three PO methods**

Inside `useProcurementApi()`, after `receiveLineItem` (line 71), add:
```ts
  async function createPurchaseOrder(lineItemIds: string[], f: { vendor?: string | null; date_purchased?: string; eta?: string; shipping_location_id?: string | null; custom_shipping_location?: string | null; notes?: string | null }): Promise<{ id: string; po_number: string }> {
    const row = ok(await db().rpc(RPCS.createPO, { p_line_item_ids: lineItemIds, p_vendor: f.vendor ?? null, p_date_purchased: f.date_purchased ?? null, p_eta: f.eta ?? null, p_shipping_location_id: f.shipping_location_id ?? null, p_custom_shipping_location: f.custom_shipping_location ?? null, p_notes: f.notes ?? null })) as { id: string; po_number: string }
    return row
  }
  async function closePurchaseOrder(id: string): Promise<void> { ok(await db().rpc(RPCS.closePO, { p_po_id: id })) }
  async function listPurchaseOrders(status: 'open' | 'closed'): Promise<PurchaseOrderRow[]> {
    const rows = ok(await db().from(TABLES.purchaseOrders)
      .select('*, line_items(*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at))')
      .eq('status', status)
      .order('created_at', { ascending: false })) ?? []
    return (rows as unknown as (Omit<PurchaseOrderRow, 'line_items'> & { line_items: (LineItemRow & { purchase_requests: LineItemWithRequest['request'] })[] })[]).map(po => {
      const { line_items, ...rest } = po
      return { ...rest, line_items: (line_items ?? []).map(li => { const { purchase_requests, ...item } = li; return { ...item, request: purchase_requests } as LineItemWithRequest }) } as PurchaseOrderRow
    })
  }
```

- [ ] **Step 5: Export the new methods**

Add `createPurchaseOrder, listPurchaseOrders, closePurchaseOrder` to the hook's `return { ... }` object (line 197, alongside the Task 3 addition of `listLineItemStatuses`).

- [ ] **Step 6: Verify typecheck + build**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/db.ts
git commit -m "feat(procurement): data layer for purchase orders (create/list/close + po_id)"
```

---

## Task 6: Purchasing pure helper (PO receive progress, TDD)

**Files:**
- Create: `src/purchasing/orders.ts`
- Test: `src/purchasing/orders.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 8-9):
  - `interface PoProgress { received: number; total: number }`
  - `poReceiveProgress(items: { status: string }[]): PoProgress`

- [ ] **Step 1: Write the failing test**

Create `src/purchasing/orders.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { poReceiveProgress } from './orders'

describe('poReceiveProgress', () => {
  it('counts received vs total', () => {
    expect(poReceiveProgress([{ status: 'received' }, { status: 'ordered' }, { status: 'received' }]))
      .toEqual({ received: 2, total: 3 })
  })
  it('handles an empty PO', () => expect(poReceiveProgress([])).toEqual({ received: 0, total: 0 }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/purchasing/orders.test.ts`
Expected: FAIL — cannot resolve `./orders`.

- [ ] **Step 3: Write the implementation**

Create `src/purchasing/orders.ts`:
```ts
export interface PoProgress { received: number; total: number }

/** Count how many of a PO's line items have been received, out of the total. */
export function poReceiveProgress(items: { status: string }[]): PoProgress {
  const total = items.length
  const received = items.filter(i => i.status === 'received').length
  return { received, total }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/purchasing/orders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/purchasing/orders.ts src/purchasing/orders.test.ts
git commit -m "feat(procurement): PO receive-progress helper (pure + tested)"
```

---

## Task 7: Purchasing page → tab shell + Ready-for-Purchasing tab (with Create PO)

**Files:**
- Create: `src/purchasing/ReadyForPurchasing.tsx`
- Create: `src/purchasing/CreatePurchaseOrderForm.tsx`
- Modify: `src/pages/PurchasingPage.tsx` (becomes the tab shell)

**Interfaces:**
- Consumes: `useProcurementApi()` (`listLineItemsByStatus`, `orderLineItem`, `cancelLineItem`, `createPurchaseOrder`, `listLocations`, `fireNotification`), `LineItemWithRequest`, `Location`, `PERMS`.
- Produces: `<ReadyForPurchasing />`, `<CreatePurchaseOrderForm />`, `<PurchasingPage />` renders a tab bar.

- [ ] **Step 1: Move the existing approved-items list into `ReadyForPurchasing.tsx`**

Create `src/purchasing/ReadyForPurchasing.tsx`. Move the **existing** approved-items logic verbatim out of `src/pages/PurchasingPage.tsx` — specifically: the `OrderForm` interface + `emptyForm()` (current lines 9-19), the `items`/`locations`/`openFormId`/`forms`/`submittingId` state + `load()` (lines 27-52), `toggleForm`/`updateForm`/`handleSubmit`/`handleCancel` (lines 54-103), and the item-card render with the inline per-item order form (the `items.map(...)` block, lines 135-305) — into this component. Preserve the per-item **Place Order** and **Cancel** behavior exactly (this satisfies "keep both order paths").

Then add multi-select on top. Add state and a selection toggle:
```tsx
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showPoForm, setShowPoForm] = useState(false)

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
```
Render a checkbox in each item card header (next to the `StatusBadge`):
```tsx
              <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="mt-1 h-4 w-4 accent-primary" aria-label="Select for purchase order" />
```
Above the list, render a selection toolbar when ≥1 selected:
```tsx
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2">
          <span className="text-sm text-foreground">{selected.size} selected</span>
          <button type="button" onClick={() => setShowPoForm(true)} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">Create Purchase Order</button>
        </div>
      )}
      {showPoForm && (
        <CreatePurchaseOrderForm
          itemIds={[...selected]}
          locations={locations}
          onCancel={() => setShowPoForm(false)}
          onCreated={async (po) => { setShowPoForm(false); setSelected(new Set()); showToast({ message: `Created ${po.po_number}`, type: 'success' }); await load() }}
        />
      )}
```
Add the import at the top of the file: `import { CreatePurchaseOrderForm } from './CreatePurchaseOrderForm'`. Keep the existing imports the component needs (`useState/useEffect/useCallback`, `useToast/usePermissions` from app-bridge, `useProcurementApi`/`LineItemWithRequest`/`Location` from `../data/db`, `StatusBadge` from `../requester/StatusBadge`, `PERMS`/`formatDate` from `../lib/constants`, `useFormattingRules` from `../formatting/useFormattingRules`, `formatItemRef` from `../lib/itemRef`). Drop the permission gate from here (the shell handles it — Step 3). Export `function ReadyForPurchasing() { ... }`.

- [ ] **Step 2: Create the PO creation form**

Create `src/purchasing/CreatePurchaseOrderForm.tsx`:
```tsx
import { useState } from 'react'
import { useProcurementApi, Location } from '../data/db'

interface Props {
  itemIds: string[]
  locations: Location[]
  onCancel: () => void
  onCreated: (po: { id: string; po_number: string }) => void | Promise<void>
}

export function CreatePurchaseOrderForm({ itemIds, locations, onCancel, onCreated }: Props) {
  const api = useProcurementApi()
  const [vendor, setVendor] = useState('')
  const [datePurchased, setDatePurchased] = useState('')
  const [eta, setEta] = useState('')
  const [shippingLocationId, setShippingLocationId] = useState('')
  const [customShipping, setCustomShipping] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOther = shippingLocationId === '__other__'

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const po = await api.createPurchaseOrder(itemIds, {
        vendor: vendor || null,
        date_purchased: datePurchased || undefined,
        eta: eta || undefined,
        shipping_location_id: isOther ? null : (shippingLocationId || null),
        custom_shipping_location: isOther ? (customShipping || null) : null,
        notes: notes || null,
      })
      // Reuse the existing per-item ordered notification, one per item.
      await Promise.all(itemIds.map(() => api.fireNotification('item_ordered')))
      await onCreated(po)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4 grid gap-3">
      <p className="text-xs font-semibold text-foreground">New Purchase Order ({itemIds.length} item{itemIds.length === 1 ? '' : 's'})</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Vendor</label>
        <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. CDW" className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Date Purchased</label>
        <input type="date" value={datePurchased} onChange={e => setDatePurchased(e.target.value)} className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">ETA</label>
        <input type="date" value={eta} onChange={e => setEta(e.target.value)} className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Shipping Location</label>
        <select value={shippingLocationId} onChange={e => setShippingLocationId(e.target.value)} className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
          <option value="">— Select location —</option>
          {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          <option value="__other__">Other</option>
        </select>
      </div>
      {isOther && (
        <div className="grid gap-1">
          <label className="text-xs font-medium text-foreground">Custom Shipping Location</label>
          <input type="text" value={customShipping} onChange={e => setCustomShipping(e.target.value)} placeholder="Enter address or location" className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
      )}
      <div className="grid gap-1">
        <label className="text-xs font-medium text-foreground">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Optional notes…" className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={submit} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{busy ? 'Creating…' : 'Create PO'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Cancel</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rebuild `PurchasingPage.tsx` as the tab shell**

Replace the entire contents of `src/pages/PurchasingPage.tsx` with a tab shell that keeps the permission gate and header, and switches between the three tabs:
```tsx
import { useState } from 'react'
import { usePermissions } from '@elasticit-llc/app-bridge'
import { PERMS } from '../lib/constants'
import { ReadyForPurchasing } from '../purchasing/ReadyForPurchasing'
import { OpenOrders } from '../purchasing/OpenOrders'
import { ClosedOrders } from '../purchasing/ClosedOrders'

type Tab = 'ready' | 'open' | 'closed'
const TABS: { key: Tab; label: string }[] = [
  { key: 'ready', label: 'Ready for Purchasing' },
  { key: 'open', label: 'Open Orders' },
  { key: 'closed', label: 'Closed Orders' },
]

export function PurchasingPage() {
  const { hasPermission } = usePermissions()
  const [tab, setTab] = useState<Tab>('ready')

  if (!hasPermission(PERMS.purchase)) {
    return (
      <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
        You do not have permission to view this page.
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Purchasing</h1>
        <p className="text-muted-foreground text-sm">Order approved items and track purchase orders.</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
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
    </div>
  )
}

export default PurchasingPage
```
> `OpenOrders` and `ClosedOrders` are created in Task 8. To keep this task independently buildable, create temporary stub files now: `src/purchasing/OpenOrders.tsx` and `src/purchasing/ClosedOrders.tsx`, each `export function OpenOrders() { return null }` / `export function ClosedOrders() { return null }`. Task 8 replaces them.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds. `App.tsx`'s `import { PurchasingPage } from './pages/PurchasingPage'` is unchanged, so routing still works.

- [ ] **Step 5: Manually verify the Ready tab in local-dev**

Run: `npm run local-dev`. On Purchasing → Ready for Purchasing: the existing approved-items list renders with per-item **Place Order**/**Cancel** working as before; selecting checkboxes reveals the **Create Purchase Order** toolbar; creating a PO shows a `Created PO-…` toast and the items leave the list (now `ordered`).

- [ ] **Step 6: Commit**

```bash
git add src/pages/PurchasingPage.tsx src/purchasing/ReadyForPurchasing.tsx src/purchasing/CreatePurchaseOrderForm.tsx src/purchasing/OpenOrders.tsx src/purchasing/ClosedOrders.tsx
git commit -m "feat(procurement): purchasing tabs shell + Ready-for-Purchasing with multi-select Create PO"
```

---

## Task 8: Open Orders + Closed Orders tabs

**Files:**
- Modify (replace stubs): `src/purchasing/OpenOrders.tsx`, `src/purchasing/ClosedOrders.tsx`

**Interfaces:**
- Consumes: `listPurchaseOrders`, `listLineItemsByStatus`, `receiveLineItem`, `closePurchaseOrder`, `fireNotification` (data layer); `PurchaseOrderRow`, `LineItemWithRequest`; `poReceiveProgress` (Task 6); `formatItemRef` (`src/lib/itemRef`); `formatDate` (`src/lib/constants`); `StatusBadge` (`src/requester/StatusBadge`).
- Produces: `<OpenOrders />`, `<ClosedOrders />`.

- [ ] **Step 1: Implement `OpenOrders.tsx`**

Replace `src/purchasing/OpenOrders.tsx`:
```tsx
import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, PurchaseOrderRow, LineItemWithRequest } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'
import { poReceiveProgress } from './orders'

export function OpenOrders() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [loose, setLoose] = useState<LineItemWithRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [openPos, ordered] = await Promise.all([
        api.listPurchaseOrders('open'),
        api.listLineItemsByStatus(['ordered', 'replacement_ordered']),
      ])
      setPos(openPos)
      setLoose(ordered.filter(i => !i.po_id)) // standalone per-item orders (no PO)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function receive(id: string) {
    setBusyId(id)
    try { await api.receiveLineItem(id); showToast({ message: 'Item marked received', type: 'success' }); await load() }
    catch (err: unknown) { showToast({ message: err instanceof Error ? err.message : 'Failed to mark received', type: 'error' }) }
    finally { setBusyId(null) }
  }
  async function closePo(id: string) {
    if (!window.confirm('Close this purchase order? Remaining items will stay in their current state.')) return
    setBusyId(id)
    try { await api.closePurchaseOrder(id); showToast({ message: 'Purchase order closed', type: 'success' }); await load() }
    catch (err: unknown) { showToast({ message: err instanceof Error ? err.message : 'Failed to close PO', type: 'error' }) }
    finally { setBusyId(null) }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  if (error) return <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
  if (pos.length === 0 && loose.length === 0) return <p className="text-sm text-muted-foreground">No open orders.</p>

  return (
    <div className="grid gap-4">
      {pos.map(po => {
        const prog = poReceiveProgress(po.line_items)
        return (
          <div key={po.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">{po.po_number}{po.vendor ? ` · ${po.vendor}` : ''}</p>
                <p className="text-xs text-muted-foreground">{prog.received} of {prog.total} received{po.eta ? ` · ETA ${formatDate(po.eta)}` : ''}</p>
              </div>
              <button type="button" disabled={busyId === po.id} onClick={() => closePo(po.id)} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">Close PO</button>
            </div>
            <div className="grid gap-2">
              {po.line_items.map(item => (
                <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                    <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.status} />
                    {item.status === 'ordered' && (
                      <button type="button" disabled={busyId === item.id} onClick={() => receive(item.id)} className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Mark Received</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {loose.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-foreground">Individual Orders (no PO)</h3>
          {loose.map(item => (
            <div key={item.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                <p className="text-xs text-muted-foreground">Qty: {item.quantity}{item.eta ? ` · ETA ${formatDate(item.eta)}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={item.status} />
                {item.status === 'ordered' && (
                  <button type="button" disabled={busyId === item.id} onClick={() => receive(item.id)} className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Mark Received</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implement `ClosedOrders.tsx`**

Replace `src/purchasing/ClosedOrders.tsx`:
```tsx
import { useState, useEffect, useCallback } from 'react'
import { useProcurementApi, PurchaseOrderRow } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'

export function ClosedOrders() {
  const api = useProcurementApi()
  const [pos, setPos] = useState<PurchaseOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setPos(await api.listPurchaseOrders('closed')) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed to load closed orders') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
  if (error) return <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
  if (pos.length === 0) return <p className="text-sm text-muted-foreground">No closed orders.</p>

  return (
    <div className="grid gap-4">
      {pos.map(po => (
        <div key={po.id} className="rounded-lg border border-border bg-card p-4 grid gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{po.po_number}{po.vendor ? ` · ${po.vendor}` : ''}</p>
            <p className="text-xs text-muted-foreground">Closed {po.closed_at ? formatDate(po.closed_at) : ''} · {po.line_items.length} item{po.line_items.length === 1 ? '' : 's'}</p>
          </div>
          <div className="grid gap-2">
            {po.line_items.map(item => (
              <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
                <p className="text-sm text-foreground truncate">{formatItemRef(item.request?.request_number, item.line_no)} — {item.item_description || 'Unnamed item'}</p>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 4: Manually verify the full PO flow in local-dev**

Run: `npm run local-dev` (pointed at the dev branch from Task 4). As a purchaser:
1. Ready for Purchasing → select 2 items → Create PO. Both leave the Ready list.
2. Open Orders → the new PO shows "0 of 2 received"; Mark Received on one → "1 of 2"; Mark Received on the second → the PO disappears from Open (auto-closed).
3. Closed Orders → the PO appears with its closed date and items.
4. Also confirm a per-item **Place Order** (Ready tab) produces an item under Open Orders' **Individual Orders (no PO)** section, receivable there.

- [ ] **Step 5: Commit**

```bash
git add src/purchasing/OpenOrders.tsx src/purchasing/ClosedOrders.tsx
git commit -m "feat(procurement): Open/Closed Orders tabs (PO receive, close, standalone orders)"
```

---

## Task 9: Release — version bump + validation

**Files:**
- Modify: `app.manifest.json` (`version`)

**Interfaces:**
- Consumes: everything above.
- Produces: shippable v0.9.0.

- [ ] **Step 1: Bump the app version**

In `app.manifest.json`, change `"version": "0.8.0",` → `"version": "0.9.0",`.

- [ ] **Step 2: Validate, test, build**

Run: `npm run validate && npx vitest run && npm run build`
Expected: validator reports no issues; all tests pass; build succeeds.

- [ ] **Step 3: (Optional) Package the bundle**

Run: `npm run package`
Expected: a `dist/*.eitapp` bundle is produced for Admin-UI upload. (Upload requires shell 0.20.0+ on the target — per CLAUDE.md.)

- [ ] **Step 4: Commit**

```bash
git add app.manifest.json
git commit -m "chore(procurement): bump app to v0.9.0 (dashboard charts + purchase orders)"
```

---

## Self-Review

**1. Spec coverage:**
- Dashboard cards fill row → Task 1. ✓
- Dashboard charts (3, ui-kit Chart, brand-themed) → Tasks 2-3. ✓
- Requests page (no change, requester-scoped) → confirmed in spec; no task needed. ✓
- PO table + `po_id` + PO number sequence + RLS → Task 4. ✓
- `create_purchase_order` / `close_purchase_order` / receive auto-close (Both) → Task 4. ✓
- Data layer PO methods → Task 5. ✓
- Ready/Open/Closed sub-tabs; both order paths; standalone orders visible → Tasks 6-8. ✓
- Manifest migration registration + version bump; `recharts` declared → Tasks 3, 4, 9. ✓

**2. Placeholder scan:** No "TBD/TODO-in-code" beyond the one intentional, documented 1000-row-cap `TODO` comment in `listLineItemStatuses` (matches the spec). Stub files in Task 7 are explicitly replaced in Task 8. No vague "add error handling" steps — every code step shows full code.

**3. Type consistency:** `PurchaseOrderRow.line_items: LineItemWithRequest[]` produced in Task 5 and consumed in Tasks 8. `poReceiveProgress(items: { status: string }[])` (Task 6) is called with `po.line_items` (Task 8) — `LineItemWithRequest` has `status`, so structurally compatible. `createPurchaseOrder` returns `{ id, po_number }` (Task 5), consumed by `CreatePurchaseOrderForm.onCreated` (Task 7). `listLineItemStatuses` added to the hook return in Task 3 and used in `DashboardPage` (Task 3). RPC arg names (`p_line_item_ids`, `p_vendor`, …) match between the SQL (Task 4) and the JS `rpc()` calls (Task 5). ✓
