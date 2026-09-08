# Procurement QA Updates — Design (2026-08-25)

Batch of five updates for the Mainspring QA portal, plus a shared ui-kit change
needed for dashboard drill-downs. Version: app `0.16.13` → `0.17.0` (MINOR — new
features), ui-kit `0.5.4` → `0.5.5` (MINOR — optional prop added).

No schema changes: `substitution_ok` already exists on `app_procurement.line_items`
and is already returned by `select('*')` queries.

## 1. Item URL label → "highly recommended"

In both request form types (in-portal and public form), change the label from
`Item URL (optional)` to `Item URL (highly recommended)`:

- `src/requester/LineItemFormRow.tsx` (used by `NewRequestForm`)
- `src/pages/PublicRequestFormPage.tsx`

## 2. Back button / New Request title layout

`src/pages/RequestsPage.tsx` renders `← Back` and the `New Request` h2 in a
`flex items-center` row, which reads as one string ("← Back New Request").
Stack them vertically: back button on its own line above the title (mirrors the
existing `RequestDetail` pattern).

## 3. Show Substitution value on item displays

Display the `substitution_ok` boolean as `Substitution: Yes/No` (always shown,
both values) in the individual item displays:

- **Approvals** — item card (`ApprovalsPage.tsx`), near the Qty line
- **Requests** — request detail item cards (`RequestDetail.tsx`)
- **Records** — new `Substitution` table column (after Qty) in `RecordsPage.tsx`

Implementation: add `substitution_ok: boolean` to the `LineItemRow` interface in
`src/data/db.ts` (data is already fetched; the interface just omits it).

## 4. Date Purchased defaults to today

The "Order Details" card in `src/purchasing/ReadyForPurchasing.tsx` should open
with `Date Purchased` pre-filled to the current date (editable, clearable).
Also apply to the multi-item `CreatePurchaseOrderForm.tsx` for consistency.

- Add an exported `todayIso()` helper (local date, `YYYY-MM-DD`) in
  `src/components/DateInput.tsx` (it already owns the ISO↔display conversion).
- `ReadyForPurchasing`: `emptyForm()` returns `date_purchased: todayIso()`.
- `CreatePurchaseOrderForm`: `useState(todayIso())`.

Display format is already `MM/DD/YYYY` via `DateInput.toDisplay()` — no change.

## 5. Dashboard drill-downs (modal) + data accuracy

### ui-kit 0.5.5 — clickable charts

Add an optional `onPointClick?: (xValue: string) => void` prop to
`Chart` (`elasticit-ui-kit/src/Chart.tsx`):

- bar/line/area: chart-level `onClick` reading `state.activeLabel`
- pie: `Pie`-level `onClick` reading the sector's `payload[xKey]`
- pointer cursor on the data marks while the handler is set

Backward compatible (optional prop). Publish flow: bump to 0.5.5, `npm pack`,
replace `vendor/elasticit-llc-ui-kit-0.5.4.tgz` with the 0.5.5 tarball in
`msr-procurement-app`, update the `package.json` `file:` reference, `npm install`.

### App — modal drill-downs

- New `src/components/Modal.tsx`: fixed overlay, centered scrollable card
  (max-w-2xl, max-h 80vh), title + close button, closes on Escape and
  backdrop click. (The app has no modal component today.)
- New pure, unit-testable helpers in `src/dashboard/drilldown.ts`:
  - `requestsByStatus(requests, status)`
  - `requestsByMonth(requests, 'YYYY-MM')`
  - `itemsByStatus(items, statuses)`
  - `itemsByLocation(items, locationNames, locationName)` — `'Other'` matches
    items with no known location
  - `myPendingRequests(requests, userId, userEmail)` — pending requests where
    `requester_id = userId` OR (`requester_id` is NULL and
    `requester_email = userEmail`)

- `DashboardPage` data refactor: replace `listLineItemFacets()` + the three
  permission-gated `listLineItemsByStatus()` calls with a single
  `listAllLineItemsDetailed()` (already RLS-scoped: requesters see their own
  items, staff roles see all — same row visibility as today, with richer rows).
  Extend its `purchase_requests` embed to also select `id, request_number` so
  drill-down rows can show `#N·M` refs. Derive item-status counts, location
  counts, and the approval/purchase/returns lists client-side.
  `listRequests()` and `countLineItems()` stay as-is.

- **KPI cards become clickable buttons** (hover affordance), each opening the
  modal with its underlying rows:

  | KPI | Drill-down rows |
  |---|---|
  | Total Items | all RLS-scoped items |
  | My Pending Requests | viewer's pending requests |
  | Pending Approvals | items `pending` + `on_hold` (approvers) |
  | Items to Order | items `approved` (purchasing) |
  | Pending Returns | items `returned` (returns) |

- **Charts become clickable**:

  | Chart | Click → rows |
  |---|---|
  | Requests by Status (pie) | requests in that status |
  | Items by Status (bar) | items in that status |
  | Requests Over Time (area) | requests submitted in that month |
  | Items by Location (bar) | items at that location |

- Modal rows (compact table): request number, requester, status badge,
  submitted date (request rows); `#N·M` + description + qty, requester, status
  badge (item rows).

### Data accuracy

- **Bug found & fixed:** "My Pending Requests" currently counts *everyone's*
  pending requests for staff roles (approvers/purchasing/admins), because their
  `listRequests()` returns all requests. Fix: scope to the viewer via
  `myPendingRequests()`. Charts remain RLS-scoped (requester = own data, staff
  = all), which is correct for their role.
- **Verification:** after implementation, cross-check every KPI and chart
  count against direct SQL on the QA branch DB (`jkbqaxpfvqbeepwhunhl`) and
  report discrepancies.
- Known caveats (unchanged, pre-existing): item reads cap at PostgREST's 1000
  rows; month buckets use UTC from `submitted_at` (documented in `stats.ts`).

## Out of scope / known limitations

- Under impersonation (preview as user), the dashboard still shows the
  operator's RLS view (JWT-driven) — same class of limitation flagged earlier
  for other pages; not fixed in this batch.
- PostgREST 1000-row cap on item reads (existing TODO in `db.ts`).

## Testing & release

- Unit tests: `drilldown.ts` helpers, `todayIso()`. Existing suite +
  `tsc --noEmit` must pass.
- ui-kit: run its test suite if present.
- Build `0.17.0`, remove stale `dist/*.eitapp`, commit, push `for-qa`.
- Manual test in Mainspring QA portal after uploading the package:
  KPI + chart drill-downs, substitution display, date default, labels, layout.
