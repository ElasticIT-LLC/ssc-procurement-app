# Phase 4 polish — purchasing visibility, substitution styling, hold notification

Date: 2026-08-31
Status: Approved (user confirmed all 4 design questions)
Version: 0.26.2 → 0.27.0 (MINOR: new user-facing fields)

## 1. Location + Ship-to on Purchasing item cards

**What:** each item card on the Purchasing page shows the item's requested
location and its `ship_to_name`, so the purchaser sees where the item goes
without opening the request detail.

**Fields** (all on `app_procurement.line_items`, already returned by the
`*` selects in `listLineItemsByStatus` / `listPurchaseOrders`):

| Display | Source |
|---------|--------|
| Location | `location_id` resolved against `locations`, fallback `custom_location` |
| Ship to | `ship_to_name` (free text entered on the request form / Rippling picker) |

**Resolution rule:** `resolveLocationName(item, locations)` — match
`location_id` in the loaded active locations; fall back to trimmed
`custom_location`; return `null` (row hidden) when neither resolves.

**Where (all 3 tabs, per user):**
- `ReadyForPurchasing` — two conditional `<p>` lines after the `Qty:` line
  (`Location: X`, `Ship to: Y`)
- `OpenOrders` — one combined line appended to the existing `Qty:` line with
  ` · ` separators (`Qty: 2 · Location: X · Ship to: Y`)
- `ClosedOrders` — same pattern as OpenOrders

**Types:** add `ship_to_name`, `shipping_location_id`,
`custom_shipping_location` to `LineItemRow` in `src/data/db.ts` (data is
already in the runtime payload; the TS interface just lacks them).

**New pure helper + tests:** `src/lib/locationLabel.ts` →
`resolveLocationName(item, locations)` with 4 regression tests
(known id, custom when id null, custom when id not in list, null when nothing).

## 2. Substitution "No" → bold red, request detail only

**Where:** `src/requester/RequestDetail.tsx` (~line 222), the item card row
`Substitution: Yes/No`.

**Change:** `No` renders as `<span className="font-bold text-red-600">No</span>`.
`Yes` stays muted. Tailwind v4 default palette is available
(`@theme reference` in app.css keeps red-600).

**Scope (per user):** request detail page only. Approvals card and Records
table intentionally unchanged.

## 3. On-Hold notification (bug fix)

**Bug:** `ApprovalsPage.tsx:75` fires `item_declined` for both `declined`
and `on_hold` decisions — so a Hold sends the requester an
"Item declined" email/bell.

**Fix:**
1. `src/lib/decisionNotification.ts` — pure
   `decisionNotificationKey(action)`:
   approved→`item_approved`, on_hold→`item_on_hold`, declined→`item_declined`.
   3 regression tests (the on_hold case is the bug).
2. `ApprovalsPage.tsx` uses the helper.
3. `app.manifest.json` `notifications[]` gains
   `{ key: item_on_hold, label: "Item on hold", description: "A requested
   item was placed on hold.", sort_order: 8 }` (no requires_permission —
   same audience gate as item_declined). The shell's publish-app edge fn
   upserts `notifications[]` into `public.app_notifications` on upload, so
   the opt-in toggle appears in the Notifications settings page after the
   0.27.0 upload.
4. Edge fn `procurement-capture-and-notify` linkMap gains
   `item_on_hold: recordsUrl` (same deep-link as Decline, per user).
5. **Migration 039** — opt-in backfill on `public.user_profiles`: for every
   row with `settings->'notifications'->>'procurement:item_declined' = 'true'`
   and `procurement:item_on_hold` not already true, jsonb_set it to true.
   Without this, existing opted-in users would silently stop receiving hold
   notifications (new keys default to off in the resolver). Idempotent.
   Applied by publish-app on the 0.27.0 upload (manifest `migrations[]`
   +39) — no manual QA apply needed.

**Recipients:** identical to Decline — the resolver
(`public.resolve_notification_recipients`) is a pure opt-in lookup on
`settings->'notifications'->>'procurement:<key>'`, so anyone opted in to the
key (requesters, and staff who opted in) gets the email + bell.

## Deliverables checklist

- [x] `src/lib/locationLabel.ts` + `.test.ts` (4 tests)
- [x] `src/lib/decisionNotification.ts` + `.test.ts` (3 tests)
- [x] `src/data/db.ts` LineItemRow +3 fields (+ fixture updates in 3 test files)
- [x] ReadyForPurchasing / OpenOrders / ClosedOrders: Location + Ship to rows
- [x] RequestDetail: Substitution No bold red
- [x] ApprovalsPage: `decisionNotificationKey(action)`
- [x] edge fn: `item_on_hold: recordsUrl` in linkMap
- [x] `app.manifest.json`: v0.27.0, notifications[] +item_on_hold, migrations[] +39
- [x] `migrations/039_item_on_hold_optin.sql`
- [x] `package.json`: v0.27.0
- [x] Gate: vitest 17 files / 89 tests, validate, build — all green
- [x] Package `dist/procurement-0.27.0.eitapp`
- [x] Push `for-qa` (df4e6f3)
- [x] Deploy edge fn to QA (CLI, jkbqaxpfvqbeepwhunhl — v61, verified byte-identical)
- [x] ClickUp handover comment on task 86eyrbzn3 (user uploads the .eitapp;
      publish-app applies 039 + upserts the catalog row on upload)

## Post-ship fix (2026-09-01, same 0.27.0 artifact — repackaged)

**Bug:** Open Orders tab blinked "Loading…" endlessly; Closed Orders tab took
minutes. Root cause: the 0.27.0 Location/Ship-to change made `OpenOrders.load`
depend on `api`, but `useProcurementApi()` returns a fresh object every render,
so the mount effect re-ran after every render — an infinite refetch loop that
also flooded the browser connection queue behind it.

**Fix:** `src/purchasing/OpenOrders.tsx` — `useCallback` deps back to `[]`
(matches ReadyForPurchasing/ClosedOrders). Regression test
`src/purchasing/OpenOrders.test.ts` (jsdom, mocks `useProcurementApi` to return
a fresh object per call — the bug precondition; asserts exactly 1 fetch over
500ms). Red before fix (test timed out at 5s on the loop), green after.

- [x] e2d3578 pushed to for-qa; gate green (18 files / 90 tests); artifact repackaged
