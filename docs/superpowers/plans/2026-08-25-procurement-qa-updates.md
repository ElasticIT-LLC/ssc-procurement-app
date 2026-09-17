# Procurement QA Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five QA-portal updates (item-URL label, back-button layout, Substitution value display, Date-Purchased default, dashboard drill-downs + data accuracy) as app v0.17.0 with a ui-kit 0.5.5 bump.

**Architecture:** Small targeted edits across the app plus one new shared prop (`onPointClick`) on the ui-kit `Chart` component, vendored as a tarball. Dashboard switches from facet/permission-gated queries to one RLS-scoped `listAllLineItemsDetailed()` and derives all charts/KPIs/drill-down lists client-side via new pure helpers in `src/dashboard/drilldown.ts`.

**Tech Stack:** React 19, TypeScript, Vite, recharts 3, Supabase (schema `app_procurement`), vitest, ui-kit vendored tgz.

## Global Constraints

- App version: `0.16.13` → `0.17.0` (MINOR — new features). Update BOTH `package.json` and `app.manifest.json`.
- ui-kit version on `for-qa`: `0.5.4` → `0.5.5-qa.0`. Vendor as `vendor/elasticit-llc-ui-kit-0.5.5-qa.0.tgz`.
- NO database schema changes — `substitution_ok` already exists and is returned by `select('*')`.
- Branch rule: `for-qa` gets pre-release/feature work only; never push production versions to `for-qa`.
- Date display format everywhere: `MM/DD/YYYY` (handled by `DateInput.toDisplay` / `formatDate`).
- Label copy: `Item URL (highly recommended)`; column/label name for the boolean: `Substitution` (values `Yes`/`No`).
- Harness quirk: `grep`/`glob`/`skill` tools fail with an `Expand-Archive` error in this session — use `bash` + `Select-String` and the `read` tool instead.
- Commit after each task (Conventional Commits). Husky pre-commit hooks run on commit.
- QA Supabase branch DB project: `jkbqaxpfvqbeepwhunhl`. QA portal: `https://green-sea-0b1451a0f.7.azurestaticapps.net`.

---

### Task 1: ui-kit — add `onPointClick` to `Chart`, pack 0.5.5-qa.0, vendor into app

**Files:**
- Modify: `C:\Users\jbugahon\Code\elasticit-ui-kit\src\Chart.tsx`
- Modify: `C:\Users\jbugahon\Code\elasticit-ui-kit\package.json` (version only)
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\package.json` (ui-kit reference)
- Create: `C:\Users\jbugahon\Code\msr-procurement-app\vendor\elasticit-llc-ui-kit-0.5.5-qa.0.tgz`
- Delete: `C:\Users\jbugahon\Code\msr-procurement-app\vendor\elasticit-llc-ui-kit-0.5.4.tgz`

**Interfaces:**
- Produces: `Chart` gains optional prop `onPointClick?: (xValue: string) => void` — called with the x-axis value (`status`, `month`, or `location` string) of the clicked bar/point/sector; data marks get pointer cursor when set. All existing `Chart` call sites unchanged.

- [ ] **Step 1: Confirm ui-kit branch and clean state**

Run: `git -C C:\Users\jbugahon\Code\elasticit-ui-kit status --short` and `git -C C:\Users\jbugahon\Code\elasticit-ui-kit branch --show-current`
Expected: clean tree, branch `for-qa` (for-qa is ahead of main by dependabot dev-dep bumps only; main is the merge target at release).

- [ ] **Step 2: Edit `src/Chart.tsx`**

Replace the `ChartProps` interface and the `Chart` function signature/body per this full new file content (colors/tooltip/grid constants unchanged):

```tsx
interface ChartProps {
  type: 'bar' | 'line' | 'area' | 'pie';
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string | string[];
  height?: number;
  className?: string;
  /**
   * Optional drill-down hook. Called with the x-axis value (as a string) of the
   * clicked bar / line-point / area-point / pie sector. When provided, the data
   * marks render with a pointer cursor. Backward compatible: omitting it keeps
   * the chart purely presentational.
   */
  onPointClick?: (xValue: string) => void;
}

export function Chart({ type, data, xKey, yKey, height = 300, className = '', onPointClick }: ChartProps) {
  const yKeys = Array.isArray(yKey) ? yKey : [yKey];
  const clickable = typeof onPointClick === 'function';
  const cursor: 'pointer' | undefined = clickable ? 'pointer' : undefined;

  function handleCartesianClick(state: { activeLabel?: string | number } | null | undefined) {
    if (!clickable || !state) return
    const label = state.activeLabel
    if (label === undefined || label === null) return
    onPointClick!(String(label))
  }

  function handlePieClick(entry: { payload?: Record<string, unknown> } | null | undefined) {
    if (!clickable || !entry) return
    const value = entry.payload ? entry.payload[xKey] : undefined
    if (value === undefined || value === null) return
    onPointClick!(String(value))
  }

  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        {type === 'bar' ? (
          <BarChart data={data} onClick={handleCartesianClick}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey={xKey} stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR, fontSize: 12 }} />
            <YAxis stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR, fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {yKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} cursor={cursor} />
            ))}
          </BarChart>
        ) : type === 'line' ? (
          <LineChart data={data} onClick={handleCartesianClick}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey={xKey} stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR, fontSize: 12 }} />
            <YAxis stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR, fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {yKeys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} cursor={cursor} />
            ))}
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} onClick={handleCartesianClick}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey={xKey} stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR, fontSize: 12 }} />
            <YAxis stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR, fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {yKeys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.15} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} cursor={cursor} />
            ))}
          </AreaChart>
        ) : (
          <PieChart>
            <Pie data={data} dataKey={yKeys[0]!} nameKey={xKey} cx="50%" cy="50%" outerRadius={100} onClick={handlePieClick} cursor={cursor}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
```

Keep the existing imports, `CHART_COLORS`, `GRID_COLOR`, `AXIS_COLOR`, `TOOLTIP_*` constants and `tooltipStyle` exactly as they are in the current file — only the interface and component body change.

- [ ] **Step 3: Typecheck/build ui-kit**

Run: `npm run build` in `C:\Users\jbugahon\Code\elasticit-ui-kit`
Expected: success (vite build + tsc emit). If tsc rejects the recharts `onClick` handler types, cast the handler arg at the call site, e.g. `onClick={(s: unknown) => handleCartesianClick(s as { activeLabel?: string | number })}` — do not loosen `ChartProps`.

- [ ] **Step 4: Bump ui-kit version**

In `C:\Users\jbugahon\Code\elasticit-ui-kit\package.json`: `"version": "0.5.4"` → `"version": "0.5.5-qa.0"`.

- [ ] **Step 5: Commit ui-kit**

```bash
git -C C:\Users\jbugahon\Code\elasticit-ui-kit add src/Chart.tsx package.json
git -C C:\Users\jbugahon\Code\elasticit-ui-kit commit -m "feat(chart): optional onPointClick drill-down prop; bump to 0.5.5-qa.0"
git -C C:\Users\jbugahon\Code\elasticit-ui-kit push
```

- [ ] **Step 6: Pack and vendor the tarball**

```bash
npm pack --pack-destination C:\Users\jbugahon\Code\msr-procurement-app\vendor
# produces elasticit-llc-ui-kit-0.5.5-qa.0.tgz in vendor/
Remove-Item C:\Users\jbugahon\Code\msr-procurement-app\vendor\elasticit-llc-ui-kit-0.5.4.tgz
```

- [ ] **Step 7: Point the app at the new tarball and install**

In `C:\Users\jbugahon\Code\msr-procurement-app\package.json`:
`"@elasticit-llc/ui-kit": "file:./vendor/elasticit-llc-ui-kit-0.5.4.tgz"` → `"@elasticit-llc/ui-kit": "file:./vendor/elasticit-llc-ui-kit-0.5.5-qa.0.tgz"`

Run: `npm install` in `C:\Users\jbugahon\Code\msr-procurement-app`
Expected: lockfile updated, install succeeds.

- [ ] **Step 8: Verify the new prop resolves in the app**

Run: `npx tsc --noEmit` in `C:\Users\jbugahon\Code\msr-procurement-app`
Expected: exit 0 (no new errors from the ui-kit types).

---

### Task 2: Item URL label → "highly recommended" (both form types)

**Files:**
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\requester\LineItemFormRow.tsx:156`
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\pages\PublicRequestFormPage.tsx:292`

**Interfaces:**
- Pure copy change; no API changes.

- [ ] **Step 1: Change both labels**

In both files, replace:
```tsx
<Field label="Item URL (optional)">
```
with:
```tsx
<Field label="Item URL (highly recommended)">
```

- [ ] **Step 2: Verify no other occurrences remain**

Run: `Get-ChildItem -Recurse src -Include *.tsx | Select-String 'Item URL'`
Expected: exactly 2 hits, both saying `(highly recommended)`.

- [ ] **Step 3: Commit**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add src/requester/LineItemFormRow.tsx src/pages/PublicRequestFormPage.tsx
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "feat(forms): mark Item URL as highly recommended in both request forms"
```

---

### Task 3: Stack Back button above "New Request" title

**Files:**
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\pages\RequestsPage.tsx:26-36`

**Interfaces:**
- Pure layout change; view state unchanged.

- [ ] **Step 1: Replace the header row**

Replace:
```tsx
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setView({ type: 'list' })}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
            <h2 className="text-lg font-semibold text-foreground">New Request</h2>
          </div>
```
with:
```tsx
          <div className="grid gap-1">
            <button
              type="button"
              onClick={() => setView({ type: 'list' })}
              className="text-sm text-muted-foreground hover:text-foreground self-start"
            >
              ← Back
            </button>
            <h2 className="text-lg font-semibold text-foreground">New Request</h2>
          </div>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` in the app repo. Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add src/pages/RequestsPage.tsx
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "fix(requests): stack Back button above New Request title"
```

---

### Task 4: Show Substitution value on item displays

**Files:**
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\data\db.ts:10` (add field to `LineItemRow`)
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\pages\ApprovalsPage.tsx` (item card, after the Qty line ~line 104)
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\requester\RequestDetail.tsx` (item card, after the Qty line ~line 112)
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\records\RecordsPage.tsx` (table header ~line 169 + row cell ~line 200)

**Interfaces:**
- `LineItemRow` gains `substitution_ok: boolean` (column already exists; `select('*')` already returns it). `LineItemWithRequest`/`LineItemDetailed` extend it automatically.

- [ ] **Step 1: Extend `LineItemRow`**

In `src/data/db.ts`, in the `LineItemRow` interface (line 10), insert `substitution_ok: boolean; ` immediately after `quantity: number; `.

- [ ] **Step 2: Approvals item card**

In `ApprovalsPage.tsx`, after:
```tsx
              <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
```
add:
```tsx
              <p className="text-xs text-muted-foreground">Substitution: {item.substitution_ok ? 'Yes' : 'No'}</p>
```

- [ ] **Step 3: RequestDetail item card**

In `RequestDetail.tsx`, after:
```tsx
                <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
```
add:
```tsx
                <p className="text-xs text-muted-foreground">Substitution: {item.substitution_ok ? 'Yes' : 'No'}</p>
```

- [ ] **Step 4: Records table column**

In `RecordsPage.tsx`, in the header row after `<th className={head}>Qty</th>` add:
```tsx
                <th className={head}>Substitution</th>
```
and in the body row after `<td className={cell}>{item.quantity}</td>` add:
```tsx
                  <td className={cell}>{item.substitution_ok ? 'Yes' : 'No'}</td>
```

- [ ] **Step 5: Typecheck + full test suite**

Run: `npx tsc --noEmit` then `npm test` in the app repo. Expected: tsc exit 0; all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add src/data/db.ts src/pages/ApprovalsPage.tsx src/requester/RequestDetail.tsx src/records/RecordsPage.tsx
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "feat(items): show Substitution yes/no value on Approvals, Request detail, and Records"
```

---

### Task 5: Date Purchased defaults to today (Order Details + PO form)

**Files:**
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\components\DateInput.tsx` (export `todayIso`)
- Create: `C:\Users\jbugahon\Code\msr-procurement-app\src\components\DateInput.test.ts`
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\purchasing\ReadyForPurchasing.tsx` (import + `emptyForm`)
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\purchasing\CreatePurchaseOrderForm.tsx` (import + initial state)

**Interfaces:**
- Produces: `todayIso(): string` from `src/components/DateInput.tsx` — local-timezone `YYYY-MM-DD` for the current date (same internal ISO format the app stores; `DateInput` renders it as `MM/DD/YYYY` via `toDisplay`).

- [ ] **Step 1: Write the failing test**

Create `src/components/DateInput.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { todayIso } from './DateInput'

describe('todayIso', () => {
  it('returns a YYYY-MM-DD string matching the local date', () => {
    const iso = todayIso()
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(iso).toBe(expected)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/DateInput.test.ts`
Expected: FAIL — `todayIso` is not exported.

- [ ] **Step 3: Implement `todayIso`**

In `src/components/DateInput.tsx`, after the existing `toIso` function (line ~30), add:
```ts
export function todayIso(): string {
  return toIso(new Date())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/DateInput.test.ts`
Expected: PASS.

- [ ] **Step 5: Default the Order Details form**

In `ReadyForPurchasing.tsx`:
- Change the import: `import { DateInput } from '../components/DateInput'` → `import { DateInput, todayIso } from '../components/DateInput'`
- Replace `emptyForm()`:
```ts
function emptyForm(): OrderForm {
  return { date_purchased: todayIso(), eta: '', shipping_location_id: '', custom_shipping_location: '', purchase_notes: '' }
}
```

- [ ] **Step 6: Default the PO form**

In `CreatePurchaseOrderForm.tsx`:
- Change the import: `import { DateInput } from '../components/DateInput'` → `import { DateInput, todayIso } from '../components/DateInput'`
- Replace `const [datePurchased, setDatePurchased] = useState('')` with `const [datePurchased, setDatePurchased] = useState(todayIso())`

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit` in the app repo. Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add src/components/DateInput.tsx src/components/DateInput.test.ts src/purchasing/ReadyForPurchasing.tsx src/purchasing/CreatePurchaseOrderForm.tsx
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "feat(purchasing): default Date Purchased to today in order forms"
```

---

### Task 6: Dashboard drill-down helper functions (TDD)

**Files:**
- Create: `C:\Users\jbugahon\Code\msr-procurement-app\src\dashboard\drilldown.ts`
- Create: `C:\Users\jbugahon\Code\msr-procurement-app\src\dashboard\drilldown.test.ts`

**Interfaces:**
- Consumes: `RequestRow`, `LineItemDetailed` from `../data/db`; `Location` name map as `Record<string, string>`.
- Produces:
  - `filterRequestsByStatus(requests: RequestRow[], status: string): RequestRow[]`
  - `filterRequestsByMonth(requests: RequestRow[], month: string): RequestRow[]` — `month` is `'YYYY-MM'`
  - `filterItemsByStatus(items: LineItemDetailed[], statuses: string[]): LineItemDetailed[]`
  - `filterItemsByLocation(items: LineItemDetailed[], locationNames: Record<string, string>, location: string): LineItemDetailed[]` — `'Other'` selects items whose `location_id` is null or resolves to no known location name (matches `itemsByLocation` bucketing in `stats.ts`)
  - `myPendingRequests(requests: RequestRow[], userId: string | null | undefined, userEmail: string | null | undefined): RequestRow[]` — status `pending` AND (`requester_id === userId` OR (`requester_id` null AND `requester_email === userEmail`))

- [ ] **Step 1: Write failing tests**

Create `src/dashboard/drilldown.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  filterRequestsByStatus,
  filterRequestsByMonth,
  filterItemsByStatus,
  filterItemsByLocation,
  myPendingRequests,
} from './drilldown'
import type { RequestRow, LineItemDetailed } from '../data/db'

const req = (over: Partial<RequestRow>): RequestRow => ({
  id: 'r1', requester_id: 'u1', requester_name: 'Jane', requester_email: 'jane@x.com',
  requester_type: 'portal_user', status: 'pending', notes: null,
  submitted_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-01T10:00:00.000Z',
  request_number: 1, ...over,
})

const item = (over: Partial<LineItemDetailed>): LineItemDetailed => ({
  id: 'i1', request_id: 'r1', item_description: 'Monitor', item_url: null, memo: null,
  quantity: 1, status: 'pending', location_id: null, custom_location: null, department_id: null,
  custom_department: null, date_needed: null, eta: null, admin_comment: null, commented_by: null,
  commented_at: null, product_image_path: null, return_reason: null, return_quantity: null,
  wants_replacement: null, return_notes: null, return_date: null,
  created_at: '2026-08-01T10:00:00.000Z', line_no: 1, return_processed_at: null, po_id: null,
  substitution_ok: true,
  request: { id: 'r1', request_number: 1, requester_name: 'Jane', requester_email: 'jane@x.com', notes: null, submitted_at: '2026-08-01T10:00:00.000Z', status: 'pending' },
  location: null, department: null,
  ...over,
})

describe('filterRequestsByStatus', () => {
  it('returns only requests with the given status', () => {
    const rows = [req({ status: 'pending' }), req({ id: 'r2', status: 'approved' })]
    expect(filterRequestsByStatus(rows, 'pending').map(r => r.id)).toEqual(['r1'])
  })
})

describe('filterRequestsByMonth', () => {
  it('buckets by YYYY-MM of submitted_at', () => {
    const rows = [
      req({ submitted_at: '2026-08-15T10:00:00.000Z' }),
      req({ id: 'r2', submitted_at: '2026-07-15T10:00:00.000Z' }),
    ]
    expect(filterRequestsByMonth(rows, '2026-08').map(r => r.id)).toEqual(['r1'])
    expect(filterRequestsByMonth(rows, '2026-07').map(r => r.id)).toEqual(['r2'])
  })
})

describe('filterItemsByStatus', () => {
  it('returns items in any of the given statuses', () => {
    const rows = [item({}), item({ id: 'i2', status: 'approved' })]
    expect(filterItemsByStatus(rows, ['pending', 'on_hold']).map(i => i.id)).toEqual(['i1'])
    expect(filterItemsByStatus(rows, ['pending', 'approved']).map(i => i.id).sort()).toEqual(['i1', 'i2'])
  })
})

describe('filterItemsByLocation', () => {
  const names = { locA: 'HQ', locB: 'Branch' }
  it('matches named locations by resolved name', () => {
    const rows = [item({ location_id: 'locA' }), item({ id: 'i2', location_id: 'locB' })]
    expect(filterItemsByLocation(rows, names, 'HQ').map(i => i.id)).toEqual(['i1'])
  })
  it("'Other' captures null/unknown locations", () => {
    const rows = [
      item({ location_id: null }),
      item({ id: 'i2', location_id: 'locA' }),
      item({ id: 'i3', location_id: 'missing' }),
    ]
    expect(filterItemsByLocation(rows, names, 'Other').map(i => i.id).sort()).toEqual(['i1', 'i3'])
  })
})

describe('myPendingRequests', () => {
  it('keeps only pending requests owned by the user (id or anon email)', () => {
    const rows = [
      req({}),
      req({ id: 'r2', status: 'approved' }),
      req({ id: 'r3', requester_id: null, requester_email: 'jane@x.com' }),
      req({ id: 'r4', requester_id: 'someone-else', requester_email: null }),
    ]
    expect(myPendingRequests(rows, 'u1', 'jane@x.com').map(r => r.id).sort()).toEqual(['r1', 'r3'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/dashboard/drilldown.test.ts`
Expected: FAIL — module `./drilldown` not found.

- [ ] **Step 3: Implement `src/dashboard/drilldown.ts`**

```ts
import type { LineItemDetailed, RequestRow } from '../data/db'

/** Requests currently in the given status. */
export function filterRequestsByStatus(requests: RequestRow[], status: string): RequestRow[] {
  return requests.filter(r => r.status === status)
}

/** Requests submitted in the given UTC month bucket ('YYYY-MM'), matching `requestsByMonth` bucketing. */
export function filterRequestsByMonth(requests: RequestRow[], month: string): RequestRow[] {
  return requests.filter(r => r.submitted_at.slice(0, 7) === month)
}

/** Line items whose status is in the given set. */
export function filterItemsByStatus(items: LineItemDetailed[], statuses: string[]): LineItemDetailed[] {
  const set = new Set(statuses)
  return items.filter(i => set.has(i.status))
}

/**
 * Line items at the given location, using the same bucketing as `itemsByLocation`
 * in stats.ts: named locations match by resolved name; 'Other' matches items
 * with no location or an unresolvable location_id.
 */
export function filterItemsByLocation(
  items: LineItemDetailed[],
  locationNames: Record<string, string>,
  location: string,
): LineItemDetailed[] {
  if (location === 'Other') {
    return items.filter(i => !(i.location_id ? locationNames[i.location_id] : undefined))
  }
  return items.filter(i => {
    const id = i.location_id
    return id !== null && locationNames[id] === location
  })
}

/**
 * Pending requests owned by the given user. Staff roles see ALL requests in
 * their list, so ownership must be applied explicitly: by requester_id for
 * in-portal submissions, or by requester_email for public-form (anonymous)
 * submissions.
 */
export function myPendingRequests(
  requests: RequestRow[],
  userId: string | null | undefined,
  userEmail: string | null | undefined,
): RequestRow[] {
  return requests.filter(r => {
    if (r.status !== 'pending') return false
    if (userId && r.requester_id === userId) return true
    if (!r.requester_id && userEmail && r.requester_email === userEmail) return true
    return false
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/dashboard/drilldown.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add src/dashboard/drilldown.ts src/dashboard/drilldown.test.ts
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "feat(dashboard): drill-down filter helpers with tests"
```

---

### Task 7: Modal component

**Files:**
- Create: `C:\Users\jbugahon\Code\msr-procurement-app\src\components\Modal.tsx`

**Interfaces:**
- Produces: `Modal({ title: string; onClose: () => void; children: ReactNode })` — fixed overlay (bg-black/50), centered card `max-w-2xl` / `max-h-[80vh]` with scrollable body, header with title + close (X) button; closes on Escape and backdrop click.

- [ ] **Step 1: Implement**

Create `src/components/Modal.tsx`:
```tsx
import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-input bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`. Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add src/components/Modal.tsx
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "feat(ui): add lightweight Modal component"
```

---

### Task 8: Dashboard drill-downs + data accuracy fix

**Files:**
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\src\data\db.ts` (`LineItemDetailed.request` gains `id` + `request_number`; `listAllLineItemsDetailed` select extended)
- Rewrite: `C:\Users\jbugahon\Code\msr-procurement-app\src\pages\DashboardPage.tsx`

**Interfaces:**
- Consumes: `Chart` with `onPointClick` (Task 1), `Modal` (Task 7), drill-down helpers (Task 6), `formatRequestNo`/`formatItemRef` from `../lib/itemRef`, `StatusBadge`.
- Produces: no new exports; page-level behavior only.

- [ ] **Step 1: Extend `LineItemDetailed` and its query**

In `src/data/db.ts`:
- Change `LineItemDetailed.request` to:
```ts
  request: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
```
- In `listAllLineItemsDetailed`, change the select from:
```ts
.select('*, purchase_requests!request_id(requester_name, requester_email, notes, submitted_at, status), locations!location_id(name), departments!department_id(name)')
```
to:
```ts
.select('*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at, status), locations!location_id(name), departments!department_id(name)')
```
- Update the internal cast type in the same function to match (`purchase_requests: { id: string; request_number: number | null; ... }`).

- [ ] **Step 2: Rewrite `DashboardPage.tsx`**

Full new file content:
```tsx
import { useState, useEffect, useCallback } from 'react'
import { useShellContext } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { Chart } from '@elasticit-llc/ui-kit'
import { useProcurementApi, RequestRow, LineItemDetailed, Location } from '../data/db'
import { StatusBadge } from '../requester/StatusBadge'
import { Modal } from '../components/Modal'
import { PERMS, formatDate, REQUEST_STATUS, LINE_ITEM_STATUS } from '../lib/constants'
import { countByStatusList, requestsByMonth, itemsByLocation } from '../dashboard/stats'
import {
  filterRequestsByStatus,
  filterRequestsByMonth,
  filterItemsByStatus,
  filterItemsByLocation,
  myPendingRequests,
} from '../dashboard/drilldown'
import { formatRequestNo, formatItemRef } from '../lib/itemRef'

type Drilldown =
  | { title: string; kind: 'request'; rows: RequestRow[] }
  | { title: string; kind: 'item'; rows: LineItemDetailed[] }

interface KpiCardProps {
  label: string
  value: number
  sub: string
  onClick: () => void
}

function KpiCard({ label, value, sub, onClick }: KpiCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to view details"
      className="rounded-lg border border-border bg-card px-4 py-3 flex-1 min-w-0 text-left hover:bg-muted transition-colors cursor-pointer"
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1 leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </button>
  )
}

const cell = 'px-3 py-2 text-xs text-foreground border-b border-border'
const head = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'

function RequestDrilldownRows({ rows }: { rows: RequestRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No requests match.</p>
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={head}>Req</th>
          <th className={head}>Requester</th>
          <th className={head}>Status</th>
          <th className={head}>Submitted</th>
          <th className={head}>Items</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td className={cell}>{formatRequestNo(r.request_number)}</td>
            <td className={cell}>{r.requester_name ?? r.requester_email ?? '—'}</td>
            <td className={cell}><StatusBadge status={r.status} /></td>
            <td className={cell}>{formatDate(r.submitted_at)}</td>
            <td className={cell}>{r.line_items?.length ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ItemDrilldownRows({ rows }: { rows: LineItemDetailed[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No items match.</p>
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={head}>Item</th>
          <th className={head}>Description</th>
          <th className={head}>Qty</th>
          <th className={head}>Requester</th>
          <th className={head}>Status</th>
          <th className={head}>Submitted</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(i => (
          <tr key={i.id}>
            <td className={cell}>{formatItemRef(i.request.request_number, i.line_no)}</td>
            <td className={cell}>{i.item_description || '—'}</td>
            <td className={cell}>{i.quantity}</td>
            <td className={cell}>{i.request.requester_name ?? i.request.requester_email ?? '—'}</td>
            <td className={cell}><StatusBadge status={i.status} /></td>
            <td className={cell}>{formatDate(i.request.submitted_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DashboardPage() {
  const { user } = useShellContext()
  const { hasAppPermission } = useAppPermissions()
  const api = useProcurementApi()

  const [requests, setRequests] = useState<RequestRow[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [items, setItems] = useState<LineItemDetailed[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null)

  const canApprove = hasAppPermission(PERMS.approve)
  const canPurchase = hasAppPermission(PERMS.purchase)
  const canReturns = hasAppPermission(PERMS.returns)
  const canCreate = hasAppPermission(PERMS.create)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [reqs, itemCount, allItems, locs] = await Promise.all([
        api.listRequests(),
        api.countLineItems(),
        api.listAllLineItemsDetailed(),
        api.listAllLocations(),
      ])
      setRequests(reqs as RequestRow[])
      setTotalItems(itemCount as number)
      setItems(allItems as LineItemDetailed[])
      setLocations(locs as Location[])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const myPending = myPendingRequests(requests, user?.id, user?.email)
  const recentItems = requests.slice(0, 5)
  const reqStatusData = countByStatusList(requests, REQUEST_STATUS)
  const itemStatusData = countByStatusList(items, LINE_ITEM_STATUS)
  const reqMonthData = requestsByMonth(requests)
  const locationNames = Object.fromEntries(locations.map(l => [l.id, l.name]))
  const itemLocationData = itemsByLocation(items, locationNames)
  const approvalItems = filterItemsByStatus(items, ['pending', 'on_hold'])
  const purchaseItems = filterItemsByStatus(items, ['approved'])
  const returnItems = filterItemsByStatus(items, ['returned'])

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Welcome back{user?.name ? `, ${user.name}` : ''}.
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
          {/* KPI row — all cards on one line, each an equal share of the width, clickable */}
          <div className="flex gap-3">
            <KpiCard
              label="Total Items"
              value={totalItems}
              sub="Across all requests"
              onClick={() => setDrilldown({ title: `Total Items (${totalItems})`, kind: 'item', rows: items })}
            />
            {canCreate && (
              <KpiCard
                label="My Pending Requests"
                value={myPending.length}
                sub="Awaiting review"
                onClick={() => setDrilldown({ title: `My Pending Requests (${myPending.length})`, kind: 'request', rows: myPending })}
              />
            )}
            {canApprove && (
              <KpiCard
                label="Pending Approvals"
                value={approvalItems.length}
                sub="Items to review"
                onClick={() => setDrilldown({ title: `Pending Approvals (${approvalItems.length})`, kind: 'item', rows: approvalItems })}
              />
            )}
            {canPurchase && (
              <KpiCard
                label="Items to Order"
                value={purchaseItems.length}
                sub="Approved &amp; ready"
                onClick={() => setDrilldown({ title: `Items to Order (${purchaseItems.length})`, kind: 'item', rows: purchaseItems })}
              />
            )}
            {canReturns && (
              <KpiCard
                label="Pending Returns"
                value={returnItems.length}
                sub="Returns to process"
                onClick={() => setDrilldown({ title: `Pending Returns (${returnItems.length})`, kind: 'item', rows: returnItems })}
              />
            )}
          </div>

          {/* Charts — each segment clickable to drill down */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests by Status</h3>
              <Chart
                type="pie"
                data={reqStatusData as unknown as Record<string, unknown>[]}
                xKey="status"
                yKey="count"
                height={240}
                onPointClick={(status) => setDrilldown({ title: `Requests — ${status}`, kind: 'request', rows: filterRequestsByStatus(requests, status) })}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Items by Status</h3>
              <Chart
                type="bar"
                data={itemStatusData as unknown as Record<string, unknown>[]}
                xKey="status"
                yKey="count"
                height={240}
                onPointClick={(status) => setDrilldown({ title: `Items — ${status}`, kind: 'item', rows: filterItemsByStatus(items, [status]) })}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Requests Over Time</h3>
              <Chart
                type="area"
                data={reqMonthData as unknown as Record<string, unknown>[]}
                xKey="month"
                yKey="count"
                height={240}
                onPointClick={(month) => setDrilldown({ title: `Requests in ${month}`, kind: 'request', rows: filterRequestsByMonth(requests, month) })}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Items by Location</h3>
              <Chart
                type="bar"
                data={itemLocationData as unknown as Record<string, unknown>[]}
                xKey="location"
                yKey="count"
                height={240}
                onPointClick={(location) => setDrilldown({ title: `Items at ${location}`, kind: 'item', rows: filterItemsByLocation(items, locationNames, location) })}
              />
            </div>
          </div>

          {/* Recent activity */}
          <div className="grid gap-3">
            <h2 className="text-base font-semibold text-foreground">Recent Activity</h2>
            {recentItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No requests yet. Submit a purchase request to get started.
              </p>
            ) : (
              recentItems.map(req => (
                <div
                  key={req.id}
                  className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {req.requester_name ?? req.requester_email ?? 'Request'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatDate(req.updated_at)}
                    </p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
              ))
            )}
          </div>
        </>
      )}

      {drilldown && (
        <Modal title={drilldown.title} onClose={() => setDrilldown(null)}>
          {drilldown.kind === 'request'
            ? <RequestDrilldownRows rows={drilldown.rows} />
            : <ItemDrilldownRows rows={drilldown.rows} />}
        </Modal>
      )}
    </div>
  )
}

export default DashboardPage
```

Notes:
- `listLineItemFacets`, `listLineItemsByStatus`, and the `LineItemWithRequest` import are no longer used by this file — remove them from the imports (done above). Do NOT delete the db functions themselves (RecordsPage/others may use them).
- `load` deps are `[]` (like `ApprovalsPage`'s load) — no permission-gated fetches remain inside it.
- "My Pending Requests" is now scoped via `myPendingRequests` — fixes the staff-roles accuracy bug (previously counted everyone's pending for full-access users).
- Item charts now derive from `items` (full detailed rows) instead of thin facets — same RLS visibility, same 1000-row PostgREST cap as before.

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit` then `npm test` in the app repo.
Expected: tsc exit 0; all tests pass (including existing `stats.test.ts`).

- [ ] **Step 4: Commit**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add src/data/db.ts src/pages/DashboardPage.tsx
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "feat(dashboard): drill-down modals for KPI cards and charts; fix My Pending Requests scoping"
```

---

### Task 9: Verify dashboard data accuracy against QA DB

**Files:** none (verification only).

**Interfaces:** consumes QA Supabase project `jkbqaxpfvqbeepwhunhl`, schema `app_procurement`.

- [ ] **Step 1: Run the comparison SQL** (via the supabase MCP `execute_sql` on `jkbqaxpfvqbeepwhunhl` — runs as service role, i.e. the admin/full-access view the dashboard shows to staff):

```sql
select 'requests_by_status' as metric, status, count(*)::text as n from app_procurement.purchase_requests group by 1 order by 1;
select 'items_by_status' as metric, status, count(*)::text as n from app_procurement.line_items group by 1 order by 1;
select 'items_by_location' as metric, coalesce(l.name, 'Other') as k, count(*)::text as n from app_procurement.line_items li left join app_procurement.locations l on l.id = li.location_id group by 1 order by 3 desc;
select 'requests_by_month' as metric, to_char(date_trunc('month', submitted_at), 'YYYY-MM') as k, count(*)::text as n from app_procurement.purchase_requests group by 1 order by 1;
select 'total_items' as metric, 'all' as k, count(*)::text as n from app_procurement.line_items;
select 'admin_pending' as metric, 'bedaef53-9de1-43a4-8e85-ef90a37963df' as k, count(*)::text as n from app_procurement.purchase_requests where status = 'pending' and requester_id = 'bedaef53-9de1-43a4-8e85-ef90a37963df';
select 'enlie_pending' as metric, 'bf07ba01-84c9-44e1-96aa-e01e6b455cf8' as k, count(*)::text as n from app_procurement.purchase_requests where status = 'pending' and (requester_id = 'bf07ba01-84c9-44e1-96aa-e01e6b455cf8' or (requester_id is null and requester_email in (select email from public.user_profiles where id = 'bf07ba01-84c9-44e1-96aa-e01e6b455cf8')));
```

Note: `requests_by_month` uses UTC truncation — the chart uses `submitted_at.slice(0,7)` on the ISO string, which is also UTC; the two should agree exactly.

- [ ] **Step 2: Compare and report**

After the app is live in QA, load the Dashboard as the admin user and compare every KPI number and every chart bar/slice against the SQL results. Record any discrepancy; fix the client-side derivation if one is found (the SQL numbers are ground truth for the staff view). Report the comparison table in the final summary.

---

### Task 10: Version bump, build, package, push

**Files:**
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\package.json` (`0.16.13` → `0.17.0`)
- Modify: `C:\Users\jbugahon\Code\msr-procurement-app\app.manifest.json` (`"version": "0.16.13"` → `"0.17.0"`)

**Interfaces:** none.

- [ ] **Step 1: Bump versions** in both files (search for `0.16.13` — exactly two occurrences expected).

- [ ] **Step 2: Full test + build**

Run: `npm test` then `npm run package` in the app repo.
Expected: all tests pass; `prebuild` validation passes; `dist/procurement-0.17.0.eitapp` produced.

- [ ] **Step 3: Remove stale artifact**

```powershell
Remove-Item C:\Users\jbugahon\Code\msr-procurement-app\dist\procurement-0.16.13.eitapp -ErrorAction SilentlyContinue
Get-ChildItem C:\Users\jbugahon\Code\msr-procurement-app\dist -Filter *.eitapp
```
Expected: only `procurement-0.17.0.eitapp` remains.

- [ ] **Step 4: Commit + push**

```bash
git -C C:\Users\jbugahon\Code\msr-procurement-app add package.json package-lock.json app.manifest.json vendor/
git -C C:\Users\jbugahon\Code\msr-procurement-app commit -m "build: bump to 0.17.0 with dashboard drill-downs and QA fixes"
git -C C:\Users\jbugahon\Code\msr-procurement-app push
```
(`dist/` is gitignored — the artifact is not committed.)

---

### Task 11: QA handover

- [ ] **Step 1: Tell the user to upload** `dist/procurement-0.17.0.eitapp` via Admin → App Management → Publish App (target: Procurement) on the QA portal, then hard-refresh.
- [ ] **Step 2: Provide the manual test checklist:**
  1. New Request form: "Item URL (highly recommended)" label (also check the public form).
  2. Requests → New Request: `← Back` on its own line above the title.
  3. Approvals / Request detail / Records: every item shows `Substitution: Yes` or `No` (Records: new column).
  4. Purchasing → Ready for Purchasing → Place Order: Date Purchased pre-filled with today (`MM/DD/YYYY`); editable; multi-item PO form also pre-filled.
  5. Dashboard: click each KPI card → modal with matching rows; click each chart segment → modal; verify counts against the Task 9 SQL numbers; verify "My Pending Requests" shows only the viewer's requests for admin/approver accounts.
  6. Impersonate a plain user → dashboard request list/chart still shows their own data only (RLS) — known limitation: items/charts reflect the operator's JWT scope during preview (unchanged this batch).
- [ ] **Step 3: ClickUp update** on task `86eymxb9v` (Procurement App Bugs/Feedback) following the standard dev-update comment format, listing the five items + the KPI scoping fix + the v0.17.0 artifact name.
