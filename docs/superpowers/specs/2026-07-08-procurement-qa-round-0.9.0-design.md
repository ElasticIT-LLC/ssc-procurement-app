# Procurement QA Round 0.9.0 — Design

**Date:** 2026-07-08
**Branch:** `feat/procurement-qa-round-0.8.0`
**Target version:** `0.9.0` (minor — backward-compatible new features)

Three QA follow-up items:

1. Dashboard — KPI cards fill the row width; add data visualizations (charts).
2. Purchasing — "Ready for Purchasing" view + Open/Closed Orders (Purchase Orders).
3. Requests — confirm requester-scoped visibility (investigation only).

---

## Feature 1 — Dashboard: full-width KPI cards + charts

**Scope:** frontend-only. No database change.

### 1a. KPI cards fill the row

Today the cards are fixed-width flex items and leave dead space on the right:

- `src/pages/DashboardPage.tsx:94` — container `<div className="flex flex-wrap gap-3">`
- `src/pages/DashboardPage.tsx:16` — each `KpiCard` has `w-44` (fixed 11rem)

**Change:** responsive grid so cards stretch to fill the row.

- Container: `flex flex-wrap gap-3` → `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3`
- Card width: `w-44` → `w-full`

Five KPI cards → five equal columns on wide screens, degrading to 3 / 2 columns on
narrower widths. The existing card content/markup is unchanged.

### 1b. Charts (ui-kit `Chart`)

Use the ui-kit `Chart` component (`@elasticit-llc/ui-kit` v0.5.4, already vendored). It is a
Recharts wrapper that auto-skins to the client's brand palette via `brand-*`/`secondary-*`
tokens — no per-client code.

- `Chart` props: `{ type: 'bar'|'line'|'area'|'pie', data: Record<string,unknown>[], xKey: string, yKey: string|string[], height?: number, className? }`.
- `recharts` is a **peer dependency** of ui-kit and currently only resolves transitively.
  Declare `recharts` (^3.8.1, the resolved version) explicitly in `package.json`.
- **Packaging check (plan-time):** verify in the vite/package config whether `recharts`
  must be **bundled** into the `.eitapp` or **externalized** (shell-provided, like
  `react`/`app-bridge`). Do not assume — confirm before packaging.

**Three charts** (all backed by existing data):

1. **Requests by Status** — `pie`. Composition of the request pipeline
   (`pending`/`on_hold`/`partially_approved`/`approved`/`declined`).
2. **Items by Status** — `bar`. Distribution of line items across the workflow
   (`pending`→`approved`→`ordered`→`received`→`returned`/…). Most operationally useful view.
3. **Requests over Time** — `area`. Request volume by month from `submitted_at`.

**Data aggregation:** a new pure, unit-tested module `src/dashboard/stats.ts` (mirrors the
existing `src/lib/requestFilter.ts` pattern) with functions:

- `requestsByStatus(requests): {status, count}[]`
- `itemsByStatus(items): {status, count}[]`
- `requestsByMonth(requests): {month, count}[]`

Fed from the queries the dashboard already runs plus, where needed, additional reads via
`useProcurementApi()`. KPI counts continue using uncapped `count` queries (e.g.
`countLineItems()`). The time-series reads request rows; **PostgREST caps at 1000 rows** —
acceptable at current volume. Leave a `TODO` to move aggregation into a `get_dashboard_stats`
RPC if volume grows.

**Explicitly out of scope:** a spend/cost chart — there is no cost/price field on line items,
and adding one is not part of this round (YAGNI).

---

## Feature 2 — Purchasing: Ready-for-Purchasing + Open/Closed Orders (POs)

**Scope:** full stack — new migration, RPCs, API layer, UI refactor.

### 2a. Data model — migration `013_purchase_orders.sql`

New `purchase_orders` table plus a link column on `line_items`:

```sql
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE,                 -- e.g. PO-2026-0001
  vendor TEXT,                                    -- free text
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by UUID,
  date_purchased DATE,
  eta DATE,
  shipping_location_id UUID REFERENCES locations (id),
  custom_shipping_location TEXT,
  notes TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders (status);

ALTER TABLE line_items ADD COLUMN IF NOT EXISTS po_id UUID REFERENCES purchase_orders (id);
CREATE INDEX IF NOT EXISTS line_items_po_idx ON line_items (po_id);
```

- **PO number:** `PO-{year}-{padded sequence}`. Use a Postgres sequence for the numeric part
  to guarantee uniqueness (avoid count+1 race conditions); the year is display formatting.
  Per-year reset is optional and not required for correctness.
- **RLS:** mirror the existing purchasing policies — purchasers
  (`apps/procurement/purchasing/manage`) and admins (`apps/procurement/admin/manage`) can
  read/write `purchase_orders`. Follow the row-ownership + permission pattern in
  `migrations/002_rpcs_and_rls.sql`.

### 2b. RPCs (wrapper-in-`public` / definer-in-`internal`)

Per the project convention (avoids advisor lints 0028/0029):

- `create_purchase_order(p_line_item_ids uuid[], p_vendor text, p_date_purchased date, p_eta date, p_shipping_location_id uuid, p_custom_shipping_location text, p_notes text) -> purchase_orders`
  - Validates every target item is currently `approved` and readable by the caller.
  - Generates `po_number`, inserts the PO, sets each item's `po_id`, flips items to `ordered`,
    and copies purchase details (`date_purchased`, `eta`, shipping, notes) onto the items so
    existing per-item views stay consistent.
- `close_purchase_order(p_po_id uuid) -> void` — manual close (`status='closed'`,
  `closed_at=now()`); supports early/partial closure.
- **Auto-close:** extend the existing `receive_line_item` RPC so that after marking an item
  received, if the item belongs to a PO and that PO has no remaining un-received items, the
  PO auto-closes. Satisfies the "auto + manual" (Both) choice.

### 2c. API layer — `src/data/db.ts`

- New interface `PurchaseOrderRow` (PO fields + `line_items: LineItemWithRequest[]`).
- `createPurchaseOrder(lineItemIds, fields)` → calls `create_purchase_order`.
- `listPurchaseOrders(status: 'open'|'closed')` → POs joined to their line items.
- `closePurchaseOrder(id)` → calls `close_purchase_order`.
- Register the three new RPC names in the `RPCS` map.

### 2d. UI — `src/pages/PurchasingPage.tsx` refactored into three sub-tabs

Single sidebar entry (no manifest page change). Tabs:

**Ready for Purchasing**
- The existing approved-items list.
- **Both order paths coexist** (per user decision):
  - Per-row quick **"Place Order"** — the existing single-item flow (`orderLineItem`),
    unchanged. Produces an ordered item with **no** `po_id`.
  - **Checkboxes + "Create Purchase Order"** — multi-select several approved items, open a PO
    form (vendor, `date_purchased`, `eta`, shipping location / custom, notes), submit →
    `createPurchaseOrder`. Produces a PO grouping the selected items.

**Open Orders**
- Section A — **Purchase Orders** with `status='open'`, each expandable to its line items,
  with **Mark Received** per item (reuses `receiveLineItem`) and a **Close PO** button.
- Section B — **Individual Orders**: line items with `status IN ('ordered','replacement_ordered')`
  and `po_id IS NULL` (from the per-row quick-order path), shown as single rows with
  **Mark Received**. Ensures nothing ordered is hidden.

**Closed Orders**
- **Purchase Orders** with `status='closed'` (read-only summary, expandable to items).
- (Standalone individually-ordered items that are received move to terminal `received` state
  and live in Records; they are not surfaced again here, to avoid duplicating the Records view.)

> **Trade-off noted:** keeping both order paths means the Orders tabs must render both
> PO-grouped and standalone (`po_id IS NULL`) orders. This is more surface area to build and
> QA than a single unified PO path, but matches the requested "keep both" behavior.

### 2e. Notifications

Reuse the existing `item_ordered` notification key, fired per item when a PO is created
(same as the current per-item order flow). No new manifest notification key required.

---

## Feature 3 — Requests page: no change

Investigation only — confirmed already correct for the create-and-view **requester** role:

- The frontend applies **no** user filter (`src/requester/RequestsList.tsx:28` calls
  `listRequests()` with no `.eq()`).
- Scoping happens at the **database RLS policy** (`migrations/002_rpcs_and_rls.sql:41`):
  `requester_id = auth.uid()` OR holds approve/purchase/admin permission.
- Status tabs already exist (`src/requester/RequestsList.tsx:23-26`,
  `src/lib/requestFilter.ts`).

So a requester submits a request and sees all of **their** requests, filtered by status. The
"everyone's requests under a My Requests heading" observed in the screenshot is the **admin**
view (admins hold a permission that widens the RLS read). No work required this round.

---

## Cross-cutting

- **Manifest (`app.manifest.json`):**
  - Register migration `013_purchase_orders.sql` under `database.migrations`.
  - Bump `version` `0.8.0` → `0.9.0`.
  - No new permission key (purchasing/manage covers POs); no new page (sub-tabs live inside
    the existing Purchasing page).
- **`package.json`:** declare `recharts` (^3.8.1) explicitly.
- **Testing:**
  - `src/dashboard/stats.ts` — unit tests (pure functions), matching `requestFilter.test.ts`.
  - PO RPCs — verify status transitions and auto-close via the existing DB/test workflow.
- **Migration rule:** `013` is a new numbered migration; never edit an applied one.

## Build sequence (high level)

1. Feature 1 (frontend-only, low risk): grid layout + `stats.ts` + charts + `recharts` in
   `package.json`; packaging externalization check.
2. Feature 2 backend: migration 013 + RPCs + RLS; manifest registration.
3. Feature 2 API layer: `db.ts` additions.
4. Feature 2 UI: Purchasing sub-tabs (Ready / Open / Closed), PO creation form, receive +
   close actions.
5. Version bump to 0.9.0; validate; package.
