# Procurement App — QA Round Design (Gevenlie feedback, 2026-07-03)

**Date:** 2026-07-06
**Author:** Jerome Bugahon (with Claude)
**Source:** ClickUp task `86exz0ujv` — Gevenlie Carreon QA comment (2026-07-03)
**Target version:** `0.7.1` → **`0.8.0`** (MINOR — backward-compatible features + additive schema)

## Context

Gevenlie's QA round raised six items. This spec covers all six. Ground rules from
`CLAUDE.md` apply: never edit an applied migration (add new numbered ones, 010+); the
manifest is the source of truth for version/notifications; SECURITY DEFINER functions use
the wrapper-in-`public` / definer-in-`internal` pattern.

Delivery: feature branch → **`for-qa`** → Gevenlie (QA) verifies → **`main`**.

## Current-state facts (verified)

- `line_items` identifies an item via `item_description` (textarea) + optional `item_url` /
  `memo` (reason). There is **no** dedicated name column, and lists fall back to
  "Unnamed item" or the request's `notes`.
- `line_items.status` enum: `pending, approved, declined, on_hold, ordered, received,
  returned, replacement_ordered` (SQL CHECK + `src/lib/constants.ts`).
- `purchase_requests.status` is a **derived rollup** (`internal.proc_recompute_request_status`):
  `pending, on_hold, partially_approved, approved, declined`.
- No status tabs/filters anywhere; each page is hard-wired to one status set. No
  human-readable request/order number. No retract/cancel path (only admin hard-delete).
- Returns are implemented: initiate from a `received` item → `returned`; purchaser
  `process_return` → `replacement_ordered` if replacement wanted. **Bug:** `replacement_ordered`
  is queried by no page (Purchasing = `['approved']`, Returns = `['returned']`), so a
  replacement dead-ends in the requester's list with no purchase action.
- Admin "Conditional Formatting" rules only tint rows; they do not create statuses. This is
  the source of "Added this rule but I don't see it under status?".

---

## A. Item Name (Gevenlie #1)

**Decision:** the existing `item_description` field *is* the item name. No schema change.

- Relabel the requester form field `item_description` from "Item Description" to **"Item Name"**
  (`src/requester/LineItemFormRow.tsx`). Keep the `memo`/reason field for the "why".
- Everywhere an item is labeled by `notes` or "Unnamed item", show `item_description`
  instead: `RequestsList`, `ApprovalsPage`, `PurchasingPage`, `ReturnsPage`, `RecordsPage`,
  `RequestDetail`.

## B. Request # + per-item reference (Gevenlie #4)

- **Schema (new migration):** add `request_number bigint` to `purchase_requests`, fed by a
  Postgres sequence, assigned at request creation. Add `line_no int` to `line_items`,
  assigned 1..N within a request at insert. Backfill both for existing rows (by `submitted_at`,
  then line order).
- **Display:** request → `#123`; line item → `#123-2 — {item name}`.
  - Requester list row shows `#123 · {first item name}` + item count (a request can hold
    multiple items).
  - Item-level views (Approvals, Purchasing, Returns, Records) show `#123-2 — {item name}`.

## C. Status tabs + counts — requester's Requests page (Gevenlie #3)

- **UI only.** `RequestsList` gains a clickable tab bar over the requester's **own** requests,
  each tab showing a **count badge**, filtering by the derived request-level status:
  `[ All ] [ Pending ] [ Partially approved ] [ Approved ] [ On hold ] [ Declined ] [ Cancelled ]`
- This surfaces declined/cancelled requests, which currently have no view.

## D. Cancel an approved item → Cancelled (Gevenlie #2)

- **Schema (new migration):** add `cancelled` to the `line_items.status` CHECK constraint;
  add to `LINE_ITEM_STATUS` + `STATUS_TONE` in `src/lib/constants.ts`.
- **RPC:** new `cancel_line_item` (public wrapper / internal definer). Transitions
  `approved → cancelled`, stamps actor + timestamp, then recomputes request status.
  Permission-gated to **approve / purchasing / admin** holders.
- **Rollup:** update `proc_recompute_request_status` so `cancelled` items are excluded from
  pending/approved math; an all-cancelled request rolls up to `cancelled`.
- **UI:** a **Cancel** button on **approved** items in the **Purchasing** page only (with a
  confirm dialog). Actor = approver / purchaser / admin.
- **Notify:** new manifest notification key `item_cancelled` → alerts the requester to
  submit a new request.

## E. Returns / replacement routing fix (Gevenlie #5)

- **Who initiates:** the **requester** (existing `RequestDetail` path) and the **admin**
  (new action on `RecordsPage`) can request a return on a `received` item.
- **Routing fix (the core bug):**
  - Return **with replacement** → item re-enters the **Purchasing** queue with a purchase
    action, then flows **Ordered → Received** again, carrying a "Replacement" badge.
    Purchasing's query widens beyond `['approved']` to include the replacement state so items
    no longer fall through.
  - Return **without replacement** → terminal **Returned**.
- Net effect: the "Coffee / Replacement Ordered" example now appears in Purchasing with a
  button instead of dead-ending in Requests.

## F. Clarify "rule vs status" (Gevenlie #6)

- **No custom statuses** (statuses stay a closed enum). Add a one-line helper on the Admin
  Conditional Formatting card: *"Formatting rules only color rows; they don't add new
  statuses."* Reply to Gevenlie in ClickUp explaining the distinction.

---

## Cross-cutting

- **Manifest:** version → `0.8.0`; add `item_cancelled` notification key. No new
  permissions / tables / edge functions / vault secrets.
- **Migrations:** additive only, numbered 010+ (item stays; request_number + line_no;
  cancelled status + `cancel_line_item`; rollup update; replacement-routing state; backfills).
- **Testing:** unit tests for rollup (cancelled + replacement transitions) and
  number/line_no assignment; manual QA of every flow on `for-qa`.

## Out of scope (this round)

- Admin-configurable / custom statuses.
- A separate order # distinct from the request #.
- Reworking returns beyond the routing fix and the admin-initiate path.
