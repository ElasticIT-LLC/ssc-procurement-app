# Procurement App — Phase 3 Design

- **Date:** 2026-08-27
- **Repo:** `msr-procurement-app` (branch `for-qa`, starting from v0.23.4 / commit `bdbeb51`)
- **Status:** All decision points confirmed in session 2026-08-27; document pending final user review
- **Version plan:** Wave A → **v0.24.0**, Wave B → **v0.25.0**, Wave C → **v0.26.0** (split into 0.26/0.27 if Wave C grows during planning)

## Items in scope

| # | Item | Wave |
|---|---|---|
| 1 | Pre-approved item list on Approvals page | B |
| 2 | Search bar on Records page | A |
| 3 | 14-day email reminder (Notifications page option, admin/approver) | C |
| 4 | Item history/log view (requester + admin) — reporting-capable | B + C |
| 5 | Per-request comment thread (emails + realtime) | C |
| 6 | Returns page tabs → Purchasing-page style | A |
| 7 | Rename Approvals "Items" tab → "For Approval" | A |
| 8 | Remove Favorite Items tab from Purchasing page | A |

## Confirmed decisions (session 2026-08-27)

1. One spec, built in waves (small shippable versions).
2. Pre-approve action **approves the current item AND adds it to the catalog**; new requests still land in For Approval normally.
3. Ordering a pre-approved item **lands in Purchasing → Ready for Purchasing** (approved line item, skips approval queue); the normal Place Order / bulk-PO flow applies from there.
4. Pre-approve permission: **admin + approver** (holders of `apps/procurement/approvals/act`). Ordering from the catalog: **admin, approver, purchaser**.
5. Every pre-approved order = a **brand-new request** (new request number). The catalog entry is a standing template, never consumed.
6. Catalog entry stores the **request-form fields** (pre-filled, editable at order time); **purchase fields** (date purchased, ETA, shipping location, purchase note, vendor for bulk PO) are filled by the purchaser in the existing Place Order step.
7. Reminder recipients: **approver/admin only**; fires **every 14 days while the request still has pending items**; 14 days from submission.
8. Reminder toggle lives on the **shell Notifications page** — zero shell changes: adding a key to `manifest.notifications[]` auto-registers it in `public.app_notifications` (via the shell's `publish-app` function) and renders on the page; `requires_permission: apps/procurement/approvals/act` limits the toggle to approvers/admins. Recipients = per-user opt-in ∩ approver holders (same pattern as `request_submitted`).
9. Comment thread: **requester + all staff with app access** can post; emails go out only on (a) staff-started thread → requester, (b) @mention → mentioned user. No email otherwise.
10. Existing per-item `admin_comment` is **unified into the thread** (backfilled once; Approvals comment box posts to the thread; Records column becomes read-only "Latest comment").
11. **No inbound email parsing** — emails contain a deep link (`?request=<id>`); replies happen in the portal in real time.
12. Comment threads are **collapsible** (collapsed by default, newest thread auto-expanded).
13. Request form **"Notes (optional)"** is also posted as the first thread comment on submit.
14. Item history: **no append-only event log.** One record per item order (`line_items` row, for both new requests and pre-approved orders) enriched with lifecycle timestamps + pre-approved linkage, so the client can run reports over requested/ordered/re-ordered items. UI history is a **derived timeline**.

## Shared infrastructure (no new external dependencies)

- **Email** — reuse the existing `procurement-capture-and-notify` edge function (HVE SMTP, sender `notifications@mainspringrecovery.com` from `client_settings.hve_sender_address`, password from `NOTIFICATION_HVE_PASSWORD` vault secret). New events: `comment_added`, `overdue_reminder`.
- **Realtime** — greenfield for this app. New tables added to the `supabase_realtime` publication via migration (same `DO` block pattern the shell used for `public.notifications`, shell migration 035). RLS gates row visibility per subscriber. **Verify at plan time** that the app's anon-key client can subscribe; fallback = 30 s polling.
- **Scheduling** — `pg_cron` (installed v1.6.4) + `net.http_post` (`pg_net`, installed v0.20.3) in the Supabase project; service-role JWT for the function call stored in `supabase_vault` (installed v0.3.1).
- **Notification catalog** — manifest `notifications[]` → `public.app_notifications` via shell `publish-app` (verified: all 6 existing keys are there). Shell `resolve_notification_recipients(p_event_type)` (migrations 035/037/040: per-user opt-in in `user_profiles.settings.notifications` ∩ app access; `service_role` only) is the recipient source.

---

## Wave A — v0.24.0 (UI only, no schema changes)

### A1. Returns page tabs (item 6)
Replace the two stacked sections ("Pending Returns (n)" / "Processed Returns (n)" headings + card grids) with the Purchasing-style tab bar — identical markup to `PurchasingPage.tsx` lines 40–51:
`<div className="flex gap-1 border-b border-border">` with buttons `px-3 py-2 text-sm font-medium -mb-px border-b-2`, active = `border-primary text-foreground`, inactive = `border-transparent text-muted-foreground hover:text-foreground`.
Tabs: **Pending (n)** | **Processed (n)**, rendered from a `{key,label}[]` array (matching Purchasing's pattern). Card grids move into the selected tab's content. Default tab: `pending`. No behavior change — same data (`listLineItemsByStatus(['returned'])`, split on `return_processed_at`), same Process Return action.

### A2. Rename Approvals "Items" tab (item 7)
Label change only: "Items" → **"For Approval"**. (Tab key `items` stays — no other code depends on the label.)

### A3. Remove Favorite Items tab from Purchasing (item 8)
Drop the `{key:'favorites', label:'Favorite Items'}` entry from `PurchasingPage`'s TABS array and delete `src/purchasing/FavoritesTab.tsx` (verify no other references first). Keep: `favorite_items` table + RLS, the heart on Closed Orders rows, the Approvals "Favorite Items" tab, `FavoritesModal`/`FavoritesLink` (used by Requests "New" title and public form).

### A4. Records search (item 2)
Single keyword input above the records table, placeholder e.g. "Search items, requesters, request #, PO #, status, location…". Client-side filter over the already-loaded rows (`listAllLineItemsDetailed`) — no schema change; the query gains a `purchase_orders!po_id(po_number)` join so PO # is searchable. Case-insensitive substring match across: `item_description`, `requester_name`, `requester_email`, `request_number`, `po_number`, `status`, location name, department name. Empty query = unfiltered. Composes with the existing "Show archived" checkbox. Show result count ("N of M items"). Pure helper `filterRecords(rows, keyword)` in `src/lib/` + vitest.

---

## Wave B — v0.25.0 (Pre-approved items + reporting enrichment)

### B1. Schema (migration 033)

```sql
CREATE TABLE app_procurement.pre_approved_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  item_url text,
  quantity int NOT NULL DEFAULT 1,
  substitution_ok boolean NOT NULL DEFAULT false,
  date_needed date,
  memo text,
  location_id uuid REFERENCES app_procurement.locations(id),
  custom_location text,
  department_id uuid REFERENCES app_procurement.departments(id),
  custom_department text,
  source_line_item_id uuid,               -- item it was pre-approved from (report lineage)
  created_by uuid,                        -- stamped by trigger (pattern: favorite_items 032)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_pre_approved_name ON app_procurement.pre_approved_items (lower(name));
```

RLS (pattern: `favorite_items` 029–032): SELECT for any authenticated (app visibility is upstream); INSERT only via RPC; UPDATE via RPC (re-approve upsert); DELETE admin-only (`admin/manage`).

Reporting columns on `line_items`:
```sql
ALTER TABLE app_procurement.line_items
  ADD COLUMN received_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN pre_approved_item_id uuid REFERENCES app_procurement.pre_approved_items(id) ON DELETE SET NULL;
CREATE INDEX idx_line_items_pre_approved ON app_procurement.line_items (pre_approved_item_id);
```

### B2. RPCs (migration 034)

- `pre_approve_line_item(p_line_item_id)` — requires `approvals/act`. Only from `pending`/`on_hold`. One transaction: apply the `decide_line_item(approved)` logic (status, `approved_by`, `approval_date`, rollup), then upsert `pre_approved_items` from the item's request-form fields (`name = item_description`, `item_url`, `quantity`, `substitution_ok`, `date_needed`, `memo`, location/department), stamping `source_line_item_id`. Returns the catalog row id.
- `order_pre_approved_item(p_pre_approved_id, p_quantity, p_ship_to_name, p_location_id, p_custom_location, p_department_id, p_custom_department, p_date_needed, p_memo, p_substitution_ok)` — requires `purchasing/manage` OR `approvals/act` OR `admin/manage`. Creates a **new** `purchase_requests` row (requester = actor, `requester_type='portal_user'`, `submission_source='in_portal'`, status computed by rollup, notes = `'Pre-approved order: <name>'`) plus one `line_items` row inserted **directly as `approved`** (`approved_by = auth.uid()`, `approval_date = now()`, `pre_approved_item_id` set), then `proc_recompute_request_status` (→ request status `approved`). The item appears in Purchasing → Ready for Purchasing; the existing Place Order / Create PO flow (date purchased, ETA, shipping location, purchase note, vendor) proceeds unchanged from there. Catalog entry is untouched (re-orderable forever).
- `delete_pre_approved_item(p_id)` — admin only.
- `receive_line_item` — recreate (v2) to also stamp `received_at = now()`.
- `cancel_line_item` — recreate (v3) to also stamp `cancelled_at = now()`.

### B3. UI (Approvals page)

- New tab **Pre-approved** between For Approval and Favorite Items. Lists catalog: item name, URL, default qty, ship-to/department, added by (name via `get_user_names`), added date. Admin-only **Remove** action.
- **Pre-approve** button on each For Approval item card, visible to `approvals/act` holders. Click → confirm dialog → `pre_approve_line_item` → toast, card updates (item leaves the queue as approved), catalog upserted.
- **New Purchase** button on each catalog row (admin/approver/purchaser). Dialog **pre-filled from the catalog entry** (name, URL, qty, substitution OK, date needed, memo, ship-to, department — all editable) → `order_pre_approved_item` → toast "Order created — see Ready for Purchasing".

### B4. Reporting (client requirement)

`line_items` is the **per-item-order fact table** — one row per item order, whether new request or pre-approved re-order. After B1/B2 every stage has a timestamp:

| Stage | Source |
|---|---|
| Requested | `line_items.created_at` / `purchase_requests.submitted_at` |
| Decision (approve/decline/hold) | `line_items.approval_date` (stamped for all decisions — verified in 002) |
| Ordered | `line_items.date_purchased` + `purchase_orders` (PO #, vendor, ETA) via `po_id` |
| Received | `line_items.received_at` (new) |
| Returned | `line_items.return_date` → processed: `return_processed_at` |
| Cancelled / archived | `cancelled_at` (new) / `archived_at` |
| Re-order linkage | `pre_approved_item_id` → catalog; `pre_approved_items.source_line_item_id` → original item |

Example report queries (documented in-repo, e.g. `docs/reports.md`): all items ever requested; all items ordered + PO; re-order count per pre-approved item (`count(*) group by pre_approved_item_id`); items requested but never ordered (age). Records page CSV export extended with: received_at, cancelled_at, pre-approved item name, source item ref.

---

## Wave C — v0.26.0 (history timeline, comment threads, 14-day reminder)

### C1. Item history (item 4) — derived timeline, no event log

No new log table (per decision 14). The "Activity" timeline is **derived** from data that now exists after Wave B:
- Request: `submitted_at`, requester name/email, request #.
- Per item: `created_at`, `approval_date` + `approved_by` (name resolved via `get_user_names`) + current status as the decision, `date_purchased` + PO number, `received_at`, `return_date`/`return_processed_at`, `cancelled_at`, `archived_at`.
- Thread comments (C2) interleaved by timestamp.

UI:
- **RequestDetail** — "Activity" section (timeline, newest first): *"J. Bugahon approved R34.2 · 2 days ago"*, *"PO-2026-0009 created · …"*, *"Marked received · …"*. Visible to the requester (own request) and staff (any request they can open) — satisfies "requester can view, admin can also view".
- **Records (admin)** — per-row **History** button → same timeline in a `Modal` (existing component).
- Read-only; updates on reload (thread portion also realtime since C2 subscribes it).

### C2. Comment threads (item 5) — the verified flow

**Schema (migration 035):**

```sql
CREATE TABLE app_procurement.request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES app_procurement.purchase_requests(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES app_procurement.request_comments(id) ON DELETE CASCADE,  -- NULL = thread root; replies point at the root (1 level deep)
  line_item_id uuid REFERENCES app_procurement.line_items(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'request' CHECK (source IN ('request','approvals','purchasing','request_notes')),
  author_id uuid,                       -- NULL for public-form requesters
  author_name text NOT NULL,            -- snapshot
  author_email text,
  author_role text NOT NULL CHECK (author_role IN ('requester','staff')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  mentioned_user_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_request_comments_request ON app_procurement.request_comments (request_id, created_at);
```

RLS: SELECT mirrors request visibility (requester OR `approvals/act`/`purchasing/manage`/`admin/manage`); **no UPDATE/DELETE policies** (immutable thread); INSERT only via RPC. Migration also adds `request_comments` to the `supabase_realtime` publication.

**RPC `post_request_comment(p_request_id, p_parent_id, p_line_item_id, p_source, p_body, p_mentions uuid[])`:**
- Auth: requester of the request, or staff holding any of approvals/act, purchasing/manage, admin/manage.
- If `p_parent_id` given it must be a root of the same request (no nesting).
- Resolves `p_mentions` against `user_profiles` (display name / email local part, case-insensitive); stores `mentioned_user_ids`.
- Stamps author from JWT + `user_profiles` (SECURITY DEFINER, same pattern as comment attribution 007).
- Returns the inserted row.

**Surfaces that create threads (root comments):**

| Surface | source | line_item_id | Notes |
|---|---|---|---|
| Approvals → For Approval item card comment box (replaces `set_line_item_comment` write) | `approvals` | the item | 1000-char cap; card shows "N comments" chip + link `?request=<id>` |
| Purchase note at order time (Place Order single + Create Purchase Order bulk) | `purchasing` | single item / null (bulk, body includes PO #) | posted after the order RPC succeeds; also still stored in `purchase_notes` |
| Request form "Notes (optional)" at submit | `request_notes` | null | inserted inside `submit_request` (v5) when notes non-empty — atomic with the request |
| RequestDetail comment box (requester or staff) | `request` | null | new-thread composer |

**Email rules** (all via `procurement-capture-and-notify` new event `comment_added`; branded template `buildCommentEmail` with author, role, item ref if any, body snippet, and deep link `{portal_url}/apps/<app-id>/requests?request=<id>`):

| Event | Email to |
|---|---|
| Staff starts a thread (any surface) | Requester (`requester_email`) |
| Requester starts a thread | Nobody (visible in portal + realtime) |
| Any reply | Only @mentioned users |
| Any comment | In-app bell row (`public.notifications`) to the counterpart: staff comment → requester (if portal user); requester comment → thread's staff author. No email for the bell-only case |

@mention: composer shows a picker on `@` (thread participants + requester first, then portal users); selected tokens resolved at submit; each matched portal user gets email + bell. Unmatched text stays plain text, no email.

**RequestDetail thread UI:**
- Threads grouped by root; each thread is a **collapsible block** — header: author name, role badge (Requester/Staff), source badge (Approvals/Purchasing/Request), item ref (if `line_item_id`), time, reply count, one-line snippet. Click toggles. Default: collapsed, **newest thread auto-expanded**.
- Reply box per thread (visible to requester of own request + staff).
- **Realtime:** subscribe `postgres_changes` on `request_comments` filtered `request_id=eq.<id>` while the detail view is open; INSERT appends live for all viewers. (Fallback: 30 s poll if realtime entitlement check fails at plan time.)
- Edge cases: public/anonymous requesters get the email with the link but cannot reply in-app (no session); if they hold a portal account with the same email, the existing email-match RLS makes the deep link work. Comments are immutable (no edit/delete, v1).

**Unification of legacy `admin_comment` (decision 10):**
- Migration backfills: each `line_items.admin_comment` non-null → one thread root comment (`source='approvals'`, `line_item_id` set, author = `commented_by` name/email via `user_profiles`, `created_at = commented_at`, body = comment).
- Approvals card comment box now calls `post_request_comment` (thread); `set_line_item_comment` RPC and the column are kept (back-compat) but no UI writes them.
- Records "Admin Comment" column → read-only **"Latest comment"** (author + date) from the thread; no inline edit there.

### C3. 14-day reminder (item 3)

- **Manifest:** add notification key `request_overdue_reminder` (label e.g. "Request pending 14+ days", `requires_permission: "apps/procurement/approvals/act"`). Auto-registers on publish; appears on the shell Notifications page for approvers/admins only; per-user opt-in there is the on/off (decision 8).
- **Schema (migration 036):** `ALTER TABLE app_procurement.purchase_requests ADD COLUMN last_overdue_reminder_at timestamptz;`
- **Edge function event `overdue_reminder`** (in `procurement-capture-and-notify`):
  1. Select requests with `status IN ('pending','on_hold','partially_approved')` AND `submitted_at <= now() - interval '14 days'` AND (`last_overdue_reminder_at IS NULL` OR `last_overdue_reminder_at <= now() - interval '14 days'`).
  2. Recipients: `resolve_notification_recipients('procurement:request_overdue_reminder')` ∩ `get_permission_holders('apps/procurement/approvals/act')` (the `request_submitted` pattern). Empty → no-op.
  3. Per request: email (branded template: request #, requester, age in days, item count, portal deep link) + bell rows; stamp `last_overdue_reminder_at = now()`.
  4. Best-effort: failures logged, never crash the schedule.
- **Schedule (migration 037):** `pg_cron` job daily 08:00 (DB timezone) → `net.http_post` to `https://<ref>.functions.supabase.co/procurement-capture-and-notify` with `{"event":"overdue_reminder"}` and a service-role JWT (stored in `supabase_vault`). The dedupe column makes it safe to run daily (re-fires per request only every 14 days while still pending).

---

## Testing

- **Unit (vitest, run in CI gate):** `filterRecords` (A4), `viewFromSearch` already covered, thread collapse state logic, mention parsing/resolution, timeline derivation (status → display events), pre-approved order dialog prefill mapping.
- **Migrations:** apply to QA (`jkbqaxpfvqbeepwhunhl`) via linked CLI before packaging; verify RLS with anon + authenticated + service role; verify backfill row count = existing non-null `admin_comment` count.
- **QA manual (per-wave handover format):** deep-link emails, realtime both-ways, reminder on a test request with `submitted_at` backdated 15 days (verify one fire + no re-fire before 14 days elapse + re-fire after), reporting query sanity (re-order counts), Records search + CSV, tab appearances.

## Rollout

- Each wave: migrate QA → package `.eitapp` (remove old artifact) → upload via Admin > App Management → QA handover comment on ClickUp task (provided by user after completion).
- Production (end of sprint / on instruction): PR `for-qa` → `main`, bump to production version, apply migrations 033–037 to prod Supabase, publish app (manifest re-syncs notification catalog), **set the `supabase_vault` cron secret in prod**, verify the `pg_cron` job exists.
- No elasticit-shell changes anywhere in Phase 3.

## Non-goals (v1)

- Inbound email reply parsing (emails deep-link into the portal only).
- Nested threads (replies-to-replies), comment edit/delete.
- Dashboard drilldowns or CSV export of the timeline (flat data already exports; reporting runs over `line_items` in SQL).
- Fuzzy re-order detection for non-pre-approved items (re-order lineage exists only via `pre_approved_item_id`).
- Editing pre-approved catalog entries (delete + re-add in v1).
- Per-event admin-forced subscriptions (opt-in model only — platform-consistent).

## Risks / open items

1. **Realtime entitlement** — app client (anon key + user JWT) must be able to subscribe to `supabase_realtime`; verify on QA, fall back to 30 s polling.
2. **pg_cron timezone** — job uses the database's timezone; confirm QA/prod timezone matches the intended 08:00.
3. **Backfill gaps** — historical `received` items have no `received_at` (never stamped); reports will show NULL for pre-Phase-3 receipts. Acceptable; note in report docs.
4. **Anonymous requesters** — email-only participants in threads (no in-app reply); deep link works only if they later hold a portal account with the same email.
5. **Bulk-PO purchase note** is one thread comment per PO (no per-item notes in the bulk form).
