# Wave B — Pre-Approved Items + Reporting Enrichment (v0.25.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec Wave B — the pre-approved item catalog (pre-approve action, order-from-catalog, admin remove) and the `line_items` reporting enrichment (received/cancel stamps, pre-approved linkage) — and ship v0.25.0 to QA.

**Architecture:** Two new migrations (033 schema, 034 RPCs) add a `pre_approved_items` catalog table and lifecycle columns on `line_items`, with all writes enforced inside SECURITY DEFINER RPCs behind the existing `check_user_permission` gates. The React app gains a "Pre-approved" tab on Approvals (catalog list + pre-filled, editable New Purchase dialog + Pre-approve button on item cards) and four extra columns in the Records CSV export. No shell, edge-function, or notification-catalog changes.

**Tech Stack:** React + TypeScript + Supabase Postgres RPCs + Tailwind; vitest for pure TS.

## Global Constraints

- Branch: `for-qa` in `C:\Users\jbugahon\Code\msr-procurement-app` (already checked out). Prerequisite: Wave A (v0.24.0) is merged into `for-qa` — its rename of the Approvals "Items" tab to "For Approval" is in effect; this plan references the post-Wave-A label.
- Version: `0.24.0` → `0.25.0` in BOTH `package.json` (line 3) and `app.manifest.json` (line 6), done in Task 7 only — no earlier task touches the version.
- Migrations are applied to QA Supabase project `jkbqaxpfvqbeepwhunhl` via the linked CLI from the repo root (`supabase db query --file <file> --linked`) BEFORE packaging. Never touch production (`rhdsvbojqinwpfumdvnu`). Note: in this environment the Supabase MCP server cannot see this project (it is a QA branch DB that is absent from `projects list`), so the CLI `--linked` path is the verified one.
- `npm run package` produces `dist/procurement-0.25.0.eitapp`; ALL older `.eitapp` files in `dist/` are deleted afterwards (repo rule: only the current version's artifact remains).
- New RPCs are `SECURITY DEFINER`, `SET search_path = app_procurement, public`, permission checks via `public.check_user_permission(auth.uid(), '<perm>')`; every RPC ends with `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated, service_role` (migrations 002/017/022 pattern).
- RLS on the new table uses the DROP+recreate fail-safe pattern: drop every existing policy on the table (including platform auto-generated permissive ones), then create the canonical set (migrations 029–032 pattern); all migrations are idempotent (publish-app re-applies from the last saved version).
- No new npm dependencies. No shell changes. No edge-function changes.
- Every task ends with a Conventional Commit (repo style `type(scope): summary; vX.Y.Z`); push to `for-qa` only in Task 8.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `migrations/033_pre_approved_items.sql` | Create | `pre_approved_items` table + `uq_pre_approved_name` (unique `lower(name)`) + RLS + `created_by` insert trigger; `line_items` columns `received_at`/`cancelled_at`/`pre_approved_item_id` + index |
| `migrations/034_pre_approved_rpcs.sql` | Create | `pre_approve_line_item`, `order_pre_approved_item`, `delete_pre_approved_item`; recreate `receive_line_item` (v2, stamps `received_at`) and `cancel_line_item` (v3, stamps `cancelled_at`) |
| `app.manifest.json` | Modify | +migration entries 33/34, +`pre_approved_items` table entry (Tasks 1–2); version `0.25.0` (Task 7) |
| `src/approvals/preApproved.ts` | Create | Pure helpers `prefillFromCatalog`, `draftToRpcPayload` (dialog prefill mapping) |
| `src/approvals/preApproved.test.ts` | Create | vitest tests for the two helpers |
| `src/approvals/PreApprovedTab.tsx` | Create | Catalog table + admin-only Remove + New Purchase dialog (pre-filled, editable) |
| `src/pages/ApprovalsPage.tsx` | Modify | New "Pre-approved" tab (between "For Approval" and "Favorite Items") + Pre-approve button on item cards |
| `src/data/db.ts` | Modify | `PreApprovedItem` type; `listPreApprovedItems`/`preApproveLineItem`/`orderPreApprovedItem`/`deletePreApprovedItem`/`lookupItemRefs`; `LineItemRow`/`LineItemDetailed`/`listAllLineItemsDetailed` extended with the three new columns + catalog-name embed |
| `src/records/RecordsPage.tsx` | Modify | CSV export adds Received, Cancelled, Pre-approved Item, Source Item |
| `docs/reports.md` | Create | `line_items` fact-table stage reference + the four spec-B4 example queries |
| `package.json` | Modify | `0.24.0` → `0.25.0` |

---

## Task 1: Migration 033 — pre_approved_items table + line_items reporting columns

**Files:**
- Create: `migrations/033_pre_approved_items.sql`
- Modify: `app.manifest.json` (migrations array — after the version 32 entry at line 66; tables array — after the `favorite_items` entry at line 75)

**Interfaces:**
- Consumes: existing `locations`, `departments`, `line_items` (migration 001); shell helper `public.check_user_permission`.
- Produces: table `app_procurement.pre_approved_items(id uuid PK, name text NOT NULL, item_url text, quantity int NOT NULL DEFAULT 1, substitution_ok boolean NOT NULL DEFAULT false, date_needed date, memo text, location_id uuid → locations(id), custom_location text, department_id uuid → departments(id), custom_department text, source_line_item_id uuid, created_by uuid, created_at timestamptz)`; unique index `uq_pre_approved_name` on `lower(name)`; RLS = SELECT any authenticated + DELETE `admin/manage` only (no INSERT/UPDATE policies → direct writes denied; all writes go through the 034 RPCs); `line_items.received_at timestamptz`, `line_items.cancelled_at timestamptz`, `line_items.pre_approved_item_id uuid REFERENCES pre_approved_items(id) ON DELETE SET NULL` + index `idx_line_items_pre_approved`.

- [ ] **Step 1: Write the migration file**

`migrations/033_pre_approved_items.sql`:

```sql
-- 033: Wave B — pre-approved items catalog + line_items reporting columns.
-- The catalog is a standing template: pre-approving a request item upserts a
-- catalog row (unique on lower(name)); ordering from the catalog creates a
-- brand-new request, so the catalog row is never consumed.
-- Reporting columns on line_items: received_at/cancelled_at lifecycle stamps
-- (stamped by the 034 receive/cancel RPC recreations) and pre_approved_item_id
-- (re-order linkage). Idempotent: publish-app re-applies from the last saved
-- version, so every object is dropped/recreated safely.

CREATE TABLE IF NOT EXISTS app_procurement.pre_approved_items (
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_pre_approved_name ON app_procurement.pre_approved_items (lower(name));

ALTER TABLE app_procurement.line_items
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_approved_item_id uuid REFERENCES app_procurement.pre_approved_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_line_items_pre_approved ON app_procurement.line_items (pre_approved_item_id);

-- RLS (pattern: favorite_items 029-032): SELECT for any authenticated user
-- (app visibility is gated upstream); NO INSERT/UPDATE policies so direct
-- writes are denied (all writes go through the SECURITY DEFINER RPCs in 034);
-- DELETE admin-only. The DO block first drops ANY existing policies on the
-- table (including platform auto-generated permissive ones) so every
-- environment converges on exactly the two canonical policies.
ALTER TABLE app_procurement.pre_approved_items ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'app_procurement' AND tablename = 'pre_approved_items' LOOP EXECUTE format('DROP POLICY %I ON app_procurement.pre_approved_items', r.policyname); END LOOP; END; $$;
CREATE POLICY pre_approved_items_read_all ON app_procurement.pre_approved_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY pre_approved_items_delete_admin ON app_procurement.pre_approved_items
  FOR DELETE TO authenticated
  USING (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'))
  WITH CHECK (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));

-- Stamp created_by on insert (pattern: favorite_items 032).
CREATE OR REPLACE FUNCTION app_procurement.set_pre_approved_item_creator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pre_approved_items_set_creator ON app_procurement.pre_approved_items;
CREATE TRIGGER trg_pre_approved_items_set_creator
  BEFORE INSERT ON app_procurement.pre_approved_items
  FOR EACH ROW
  EXECUTE FUNCTION app_procurement.set_pre_approved_item_creator();
```

- [ ] **Step 2: Add manifest entries**

In `app.manifest.json`, the migrations array currently ends (line 66) with:

```json
      { "version": 32, "description": "Favorites: only approvers/purchasers/admins may insert; trigger stamps created_by for Added-by attribution", "up": "migrations/032_favorite_items_curators.sql" }
    ],
```

Replace that block with:

```json
      { "version": 32, "description": "Favorites: only approvers/purchasers/admins may insert; trigger stamps created_by for Added-by attribution", "up": "migrations/032_favorite_items_curators.sql" },
      { "version": 33, "description": "Pre-approved items catalog (table + RLS + created_by trigger) + line_items reporting columns (received_at, cancelled_at, pre_approved_item_id)", "up": "migrations/033_pre_approved_items.sql" }
    ],
```

And in the `database.tables` array (line 75 currently), replace:

```json
      { "name": "favorite_items",    "rls": { "read": "authenticated", "write": "admin" } }
```

with:

```json
      { "name": "favorite_items",    "rls": { "read": "authenticated", "write": "admin" } },
      { "name": "pre_approved_items","rls": { "read": "authenticated", "write": "admin" } }
```

- [ ] **Step 3: Preflight — confirm the linked DB is QA and un-migrated**

Run (workdir `C:\Users\jbugahon\Code\msr-procurement-app`):

```
supabase db query "SELECT (SELECT count(*) FROM app_procurement.line_items) AS line_items, (to_regclass('app_procurement.pre_approved_items') IS NULL) AS catalog_absent" --linked
```

Expected: `line_items` ≈ 36 (QA data volume as of 2026-08-27 — if wildly different, STOP and confirm the CLI link target is `jkbqaxpfvqbeepwhunhl` and not production) and `catalog_absent = t`.

- [ ] **Step 4: Apply to QA**

Run:

```
supabase db query --file migrations/033_pre_approved_items.sql --linked
```

Expected: "Initialising login role..." then no ERROR lines.

- [ ] **Step 5: Verify**

Run each query with `supabase db query "<sql>" --linked` (workdir `C:\Users\jbugahon\Code\msr-procurement-app`):

1. Columns:

```
supabase db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='app_procurement' AND table_name='pre_approved_items' ORDER BY ordinal_position" --linked
```

Expected: 14 rows, in order: `id uuid`, `name text`, `item_url text`, `quantity integer`, `substitution_ok boolean`, `date_needed date`, `memo text`, `location_id uuid`, `custom_location text`, `department_id uuid`, `custom_department text`, `source_line_item_id uuid`, `created_by uuid`, `created_at timestamp with time zone`.

2. New line_items columns:

```
supabase db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='app_procurement' AND table_name='line_items' AND column_name IN ('received_at','cancelled_at','pre_approved_item_id') ORDER BY column_name" --linked
```

Expected: exactly 3 rows — `cancelled_at timestamp with time zone`, `pre_approved_item_id uuid`, `received_at timestamp with time zone`.

3. Indexes:

```
supabase db query "SELECT indexname FROM pg_indexes WHERE schemaname='app_procurement' AND indexname IN ('uq_pre_approved_name','idx_line_items_pre_approved') ORDER BY indexname" --linked
```

Expected: 2 rows — `idx_line_items_pre_approved`, `uq_pre_approved_name`.

4. FK on the linkage column is ON DELETE SET NULL:

```
supabase db query "SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='app_procurement.line_items'::regclass AND contype='f' AND confrelid='app_procurement.pre_approved_items'::regclass" --linked
```

Expected: 1 row with `confdeltype = s` (SET NULL).

5. Exactly the two canonical policies, nothing else:

```
supabase db query "SELECT polname, cmd FROM pg_policies WHERE schemaname='app_procurement' AND tablename='pre_approved_items' ORDER BY polname" --linked
```

Expected: exactly 2 rows — `pre_approved_items_delete_admin | DELETE` and `pre_approved_items_read_all | SELECT`.

6. Trigger exists:

```
supabase db query "SELECT tgname FROM pg_trigger WHERE tgrelid='app_procurement.pre_approved_items'::regclass AND NOT tgisinternal" --linked
```

Expected: 1 row — `trg_pre_approved_items_set_creator`.

7. Case-insensitive uniqueness (the second INSERT must fail; the probe is rolled back):

```
supabase db query "BEGIN; INSERT INTO app_procurement.pre_approved_items (name) VALUES ('__waveb_probe__'); INSERT INTO app_procurement.pre_approved_items (name) VALUES ('__WAVEB_PROBE__'); ROLLBACK;" --linked
```

Expected: the command errors with `duplicate key value violates unique constraint "uq_pre_approved_name"` (23505). If it returns without error, the unique index is missing — stop and re-check.

- [ ] **Step 6: Commit**

```
git add migrations/033_pre_approved_items.sql app.manifest.json
git commit -m "feat(pre-approved): migration 033 - pre_approved_items catalog (RLS, created_by trigger) + line_items received_at/cancelled_at/pre_approved_item_id; v0.25.0"
```

---

## Task 2: Migration 034 — pre-approved RPCs + receive/cancel timestamp recreations

**Files:**
- Create: `migrations/034_pre_approved_rpcs.sql`
- Modify: `app.manifest.json` (migrations array — after the version 33 entry)

**Interfaces:**
- Consumes: `pre_approved_items` table (Task 1); `line_items.received_at`/`cancelled_at`/`pre_approved_item_id` (Task 1); `internal.proc_recompute_request_status` (migration 011, which knows about `cancelled`); `public.check_user_permission`; `public.user_profiles(display_name, email)` (shell schema); `internal.proc_assign_line_no` trigger (migration 010, auto-assigns `line_no` on the new line item).
- Produces:
  - `app_procurement.pre_approve_line_item(p_line_item_id uuid) RETURNS uuid` — requires `approvals/act`; item must be `pending` or `on_hold`; approves the item AND upserts `pre_approved_items` on `lower(name)`; returns the catalog row id.
  - `app_procurement.order_pre_approved_item(p_pre_approved_id uuid, p_name text, p_item_url text, p_quantity int, p_ship_to_name text, p_location_id uuid, p_custom_location text, p_department_id uuid, p_custom_department text, p_date_needed date, p_memo text, p_substitution_ok boolean) RETURNS uuid` — requires `purchasing/manage` OR `approvals/act` OR `admin/manage`; creates a NEW `purchase_requests` row (`requester_id = auth.uid()`, `requester_type='portal_user'`, `submission_source='in_portal'`, `status='pending'`, `notes='Pre-approved order: <name>'`) plus ONE `line_items` row inserted directly as `approved` (`approved_by = auth.uid()`, `approval_date = now()`, `pre_approved_item_id = p_pre_approved_id`); runs the rollup (→ request `approved`); returns the new line item id. Catalog row is NOT modified.
  - `app_procurement.delete_pre_approved_item(p_id uuid) RETURNS void` — requires `admin/manage`.
  - `app_procurement.receive_line_item(p_line_item_id uuid) RETURNS void` — v2: identical to the migration-014 version (requester/admin/purchaser; PO auto-close) plus `received_at = now()`.
  - `app_procurement.cancel_line_item(p_line_item_id uuid) RETURNS void` — v3: identical to the migration-022 version (approver/purchaser/admin; cancels `approved`/`ordered`; closes empty PO) plus `cancelled_at = now()`.
- All five are granted to `authenticated, service_role` and revoked from `PUBLIC`.

- [ ] **Step 1: Write the migration file**

`migrations/034_pre_approved_rpcs.sql`:

```sql
-- 034: Wave B — pre-approved catalog RPCs + lifecycle-timestamp RPC recreations.
-- pre_approve_line_item: approves an item AND upserts the standing pre-approved
-- catalog entry (unique on lower(name)) from the item's request-form fields.
-- order_pre_approved_item: creates a brand-new request (requester = actor) with
-- one line item inserted directly as 'approved' and linked to the catalog row.
-- The catalog row is never consumed; p_name/p_item_url may override catalog
-- values at order time (NULL/empty falls back to the catalog values).
-- receive_line_item v2 and cancel_line_item v3 add the received_at / cancelled_at
-- reporting stamps on top of the 014 / 022 behavior.
-- Idempotent: publish-app re-applies from the last saved version.

CREATE OR REPLACE FUNCTION app_procurement.pre_approve_line_item(p_line_item_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_req uuid; v_cat uuid;
  v_desc text; v_url text; v_qty int; v_subst boolean; v_date date; v_memo text;
  v_loc uuid; v_custom_loc text; v_dept uuid; v_custom_dept text;
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act') THEN
    RAISE EXCEPTION 'Not permitted to pre-approve';
  END IF;
  UPDATE app_procurement.line_items
     SET status = 'approved', approved_by = auth.uid(), approval_date = now(), updated_at = now()
   WHERE id = p_line_item_id AND status IN ('pending','on_hold')
  RETURNING request_id, item_description, item_url, quantity, substitution_ok, date_needed, memo,
            location_id, custom_location, department_id, custom_department
    INTO v_req, v_desc, v_url, v_qty, v_subst, v_date, v_memo, v_loc, v_custom_loc, v_dept, v_custom_dept;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'Item not found or not in a decidable state';
  END IF;
  IF v_desc IS NULL OR trim(v_desc) = '' THEN
    RAISE EXCEPTION 'Item has no description; cannot pre-approve';
  END IF;
  INSERT INTO app_procurement.pre_approved_items
    (name, item_url, quantity, substitution_ok, date_needed, memo, location_id, custom_location, department_id, custom_department, source_line_item_id)
  VALUES
    (v_desc, v_url, v_qty, v_subst, v_date, v_memo, v_loc, v_custom_loc, v_dept, v_custom_dept, p_line_item_id)
  ON CONFLICT (lower(name)) DO UPDATE SET
    item_url          = EXCLUDED.item_url,
    quantity          = EXCLUDED.quantity,
    substitution_ok   = EXCLUDED.substitution_ok,
    date_needed       = EXCLUDED.date_needed,
    memo              = EXCLUDED.memo,
    location_id       = EXCLUDED.location_id,
    custom_location   = EXCLUDED.custom_location,
    department_id     = EXCLUDED.department_id,
    custom_department = EXCLUDED.custom_department,
    source_line_item_id = EXCLUDED.source_line_item_id
  RETURNING id INTO v_cat;
  PERFORM internal.proc_recompute_request_status(v_req);
  RETURN v_cat;
END; $fn$;

CREATE OR REPLACE FUNCTION app_procurement.order_pre_approved_item(
  p_pre_approved_id uuid, p_name text, p_item_url text, p_quantity int,
  p_ship_to_name text, p_location_id uuid, p_custom_location text,
  p_department_id uuid, p_custom_department text, p_date_needed date,
  p_memo text, p_substitution_ok boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_req uuid; v_li uuid;
  v_cat_name text; v_cat_url text;
  v_actor_name text; v_actor_email text;
BEGIN
  IF NOT (public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
          OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
          OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')) THEN
    RAISE EXCEPTION 'Not permitted to order pre-approved items';
  END IF;
  SELECT name, item_url INTO v_cat_name, v_cat_url
    FROM app_procurement.pre_approved_items WHERE id = p_pre_approved_id;
  IF v_cat_name IS NULL THEN RAISE EXCEPTION 'Pre-approved item not found'; END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  SELECT coalesce(nullif(display_name, ''), email), email
    INTO v_actor_name, v_actor_email
    FROM user_profiles WHERE id = auth.uid();
  INSERT INTO app_procurement.purchase_requests
    (requester_id, requester_name, requester_email, requester_type, submission_source, status, notes, submitted_at)
  VALUES
    (auth.uid(), v_actor_name, v_actor_email, 'portal_user', 'in_portal', 'pending',
     'Pre-approved order: ' || coalesce(nullif(trim(p_name), ''), v_cat_name), now())
  RETURNING id INTO v_req;
  INSERT INTO app_procurement.line_items
    (request_id, ship_to_name, location_id, custom_location, department_id, custom_department,
     item_url, item_description, memo, quantity, substitution_ok, date_needed,
     status, approved_by, approval_date, pre_approved_item_id)
  VALUES
    (v_req, p_ship_to_name, p_location_id, p_custom_location, p_department_id, p_custom_department,
     nullif(coalesce(p_item_url, v_cat_url), ''), coalesce(nullif(trim(p_name), ''), v_cat_name),
     p_memo, p_quantity, coalesce(p_substitution_ok, false), p_date_needed,
     'approved', auth.uid(), now(), p_pre_approved_id)
  RETURNING id INTO v_li;
  PERFORM internal.proc_recompute_request_status(v_req);
  RETURN v_li;
END; $fn$;

CREATE OR REPLACE FUNCTION app_procurement.delete_pre_approved_item(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN
    RAISE EXCEPTION 'Not permitted to delete pre-approved items';
  END IF;
  DELETE FROM app_procurement.pre_approved_items WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pre-approved item not found'; END IF;
END; $fn$;

-- receive_line_item v2 (supersedes the 014 version): identical behavior
-- (requester/admin/purchaser; auto-closes the PO once no non-received items
-- remain) plus the received_at reporting stamp.
CREATE OR REPLACE FUNCTION app_procurement.receive_line_item(p_line_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE v_owner uuid; v_po uuid; v_remaining int;
BEGIN
  SELECT pr.requester_id, li.po_id INTO v_owner, v_po
    FROM app_procurement.line_items li
    JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id
    WHERE li.id = p_line_item_id;
  IF v_owner IS DISTINCT FROM auth.uid()
     AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
     AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN
    RAISE EXCEPTION 'Not permitted to mark received';
  END IF;
  UPDATE app_procurement.line_items
     SET status='received', received_at=now(), updated_at=now()
   WHERE id=p_line_item_id AND status='ordered';
  IF v_po IS NOT NULL THEN
    SELECT count(*) INTO v_remaining FROM app_procurement.line_items WHERE po_id=v_po AND status <> 'received';
    IF v_remaining = 0 THEN
      UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=v_po AND status='open';
    END IF;
  END IF;
END; $fn$;

-- cancel_line_item v3 (supersedes the 022 version): identical behavior
-- (approver/purchaser/admin; cancels approved/ordered; closes the PO when no
-- active items remain) plus the cancelled_at reporting stamp.
CREATE OR REPLACE FUNCTION app_procurement.cancel_line_item(p_line_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE v_req uuid; v_po uuid; v_remaining int;
BEGIN
  IF NOT (public.check_user_permission(auth.uid(),'apps/procurement/approvals/act')
          OR public.check_user_permission(auth.uid(),'apps/procurement/purchasing/manage')
          OR public.check_user_permission(auth.uid(),'apps/procurement/admin/manage')) THEN
    RAISE EXCEPTION 'Not permitted to cancel';
  END IF;
  UPDATE app_procurement.line_items
     SET status='cancelled', cancelled_at=now(), updated_at=now()
   WHERE id=p_line_item_id AND status IN ('approved','ordered')
  RETURNING request_id, po_id INTO v_req, v_po;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Item not found or not approved/ordered'; END IF;
  IF v_po IS NOT NULL THEN
    SELECT count(*) INTO v_remaining FROM app_procurement.line_items WHERE po_id=v_po AND status NOT IN ('cancelled','received');
    IF v_remaining = 0 THEN
      UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=v_po AND status='open';
    END IF;
  END IF;
  PERFORM internal.proc_recompute_request_status(v_req);
END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.pre_approve_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.pre_approve_line_item(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app_procurement.order_pre_approved_item(uuid, text, text, int, text, uuid, text, uuid, text, date, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.order_pre_approved_item(uuid, text, text, int, text, uuid, text, uuid, text, date, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app_procurement.delete_pre_approved_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.delete_pre_approved_item(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app_procurement.receive_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.receive_line_item(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app_procurement.cancel_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.cancel_line_item(uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Add manifest migration entry**

In `app.manifest.json`, the version 33 entry added in Task 1 is currently the last migrations-array entry (no trailing comma). Replace:

```json
      { "version": 33, "description": "Pre-approved items catalog (table + RLS + created_by trigger) + line_items reporting columns (received_at, cancelled_at, pre_approved_item_id)", "up": "migrations/033_pre_approved_items.sql" }
    ],
```

with:

```json
      { "version": 33, "description": "Pre-approved items catalog (table + RLS + created_by trigger) + line_items reporting columns (received_at, cancelled_at, pre_approved_item_id)", "up": "migrations/033_pre_approved_items.sql" },
      { "version": 34, "description": "Pre-approved RPCs (pre_approve_line_item, order_pre_approved_item, delete_pre_approved_item) + receive_line_item v2 / cancel_line_item v3 with received_at/cancelled_at stamps", "up": "migrations/034_pre_approved_rpcs.sql" }
    ],
```

- [ ] **Step 3: Apply to QA**

Run (workdir `C:\Users\jbugahon\Code\msr-procurement-app`):

```
supabase db query --file migrations/034_pre_approved_rpcs.sql --linked
```

Expected: "Initialising login role..." then no ERROR lines.

- [ ] **Step 4: Verify signatures, grants, and permission gates**

Run each with `supabase db query "<sql>" --linked`:

1. Signatures:

```
supabase db query "SELECT proname, proargtypes::regtype[] AS args, prorettype::regtype AS ret FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app_procurement' AND proname IN ('pre_approve_line_item','order_pre_approved_item','delete_pre_approved_item','receive_line_item','cancel_line_item') ORDER BY proname" --linked
```

Expected: exactly 5 rows:
- `cancel_line_item | {uuid} | void`
- `delete_pre_approved_item | {uuid} | void`
- `order_pre_approved_item | {uuid, text, text, integer, text, uuid, text, uuid, text, date, text, boolean} | uuid`
- `pre_approve_line_item | {uuid} | uuid`
- `receive_line_item | {uuid} | void`

2. Grants — each of the 5 functions executable by `authenticated` and `service_role` (10 rows):

```
supabase db query "SELECT p.proname, a.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE n.nspname = 'app_procurement' AND p.proname IN ('pre_approve_line_item','order_pre_approved_item','delete_pre_approved_item','receive_line_item','cancel_line_item') AND a.privilege_type = 'EXECUTE' ORDER BY p.proname, a.rolname" --linked
```

3. Permission gate fires for unauthenticated callers (the CLI session has no JWT, so `auth.uid()` is NULL and `check_user_permission` returns false — expect the permission exception, proving the gate runs before any row access):

```
supabase db query "SELECT app_procurement.pre_approve_line_item(gen_random_uuid())" --linked
```
Expected: error `Not permitted to pre-approve` (no data change).

```
supabase db query "SELECT app_procurement.delete_pre_approved_item(gen_random_uuid())" --linked
```
Expected: error `Not permitted to delete pre-approved items`.

```
supabase db query "SELECT app_procurement.order_pre_approved_item(gen_random_uuid(), NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)" --linked
```
Expected: error `Not permitted to order pre-approved items`.

- [ ] **Step 5: Commit**

```
git add migrations/034_pre_approved_rpcs.sql app.manifest.json
git commit -m "feat(pre-approved): migration 034 - pre_approve_line_item, order_pre_approved_item, delete_pre_approved_item + receive v2 / cancel v3 timestamp stamps; v0.25.0"
```
## Task 3: `db.ts` — catalog list/order/pre-approve/delete + `lookupItemRefs` + reporting fields

**Files:**
- Modify: `src/data/db.ts` (8 targeted edits)

**Context:** Wire the Wave B RPCs/tables into the client API. All new calls follow the existing
`ok(...)` pattern (throw on error). `orderPreApprovedItem` takes a `p_*`-shaped field object so the
UI's `draftToRpcPayload` (Task 4) maps 1:1.

### Step 1: Apply the 8 edits

**(a) `TABLES` (line 6) — add the catalog table:**
```ts
const TABLES = { requests: 'purchase_requests', lineItems: 'line_items', locations: 'locations', departments: 'departments', config: '_config', purchaseOrders: 'purchase_orders', favoriteItems: 'favorite_items', preApprovedItems: 'pre_approved_items' } as const
```

**(b) `RPCS` (line 7) — add the 3 Wave B RPCs:**
```ts
const RPCS = { submit: 'submit_request', submitAnon: 'submit_request_anon', decide: 'decide_line_item', order: 'order_line_item', receive: 'receive_line_item', initiateReturn: 'initiate_return', processReturn: 'process_return', setComment: 'set_line_item_comment', deleteItem: 'delete_line_item', archiveItem: 'archive_line_item', cancel: 'cancel_line_item', getUserNames: 'get_user_names', getFormattingRules: 'get_formatting_rules', createPO: 'create_purchase_order', closePO: 'close_purchase_order', preApprove: 'pre_approve_line_item', orderPreApproved: 'order_pre_approved_item', deletePreApproved: 'delete_pre_approved_item' } as const
```

**(c) `LineItemRow` (line 10) — add the 3 reporting columns from migration 033 (append at end of the property list, before the closing `}`):**
```ts
export interface LineItemRow { id: string; request_id: string; item_description: string | null; item_url: string | null; memo: string | null; quantity: number; substitution_ok: boolean; status: LineItemStatus; location_id: string | null; custom_location: string | null; department_id: string | null; custom_department: string | null; date_needed: string | null; eta: string | null; admin_comment: string | null; commented_by: string | null; commented_at: string | null; product_image_path: string | null; return_reason: string | null; return_quantity: number | null; wants_replacement: boolean | null; return_notes: string | null; return_date: string | null; created_at: string; line_no: number | null; return_processed_at: string | null; po_id: string | null; archived_at: string | null; received_at: string | null; cancelled_at: string | null; pre_approved_item_id: string | null }
```

**(d) New `PreApprovedItem` interface — insert after the `FavoriteItem` interface (line 46):**
```ts
export interface PreApprovedItem { id: string; name: string; item_url: string | null; quantity: number; substitution_ok: boolean; location_id: string | null; custom_location: string | null; department_id: string | null; custom_department: string | null; date_needed: string | null; memo: string | null; created_by: string | null; created_at: string; source_line_item_id: string | null }
```

**(e) `LineItemDetailed` (lines 38–42) — add the embedded catalog name:**
```ts
export interface LineItemDetailed extends LineItemRow {
  request: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
  location: { name: string } | null
  department: { name: string } | null
  preApproved: { name: string } | null
}
```

**(f) `listAllLineItemsDetailed` (lines 144–158) — select + map the catalog embed:**
```ts
  async function listAllLineItemsDetailed(includeArchived = false): Promise<LineItemDetailed[]> {
    let query = db().from(TABLES.lineItems)
      .select('*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at, status), locations!location_id(name), departments!department_id(name), pre_approved_items!pre_approved_item_id(name)')
      .order('created_at', { ascending: false })
    if (!includeArchived) query = query.is('archived_at', null)
    const rows = ok(await query) ?? []
    return (rows as unknown as (LineItemRow & {
      purchase_requests: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
      locations: { name: string } | null
      departments: { name: string } | null
      pre_approved_items: { name: string } | null
    })[]).map(row => {
      const { purchase_requests, locations, departments, pre_approved_items, ...item } = row
      return { ...item, request: purchase_requests, location: locations, department: departments, preApproved: pre_approved_items } as LineItemDetailed
    })
  }
```

**(g) New catalog + lookup functions — insert after `removeFavorite` (lines 265–267):**
```ts
  // Pre-approved items catalog (table from migration 033, RPCs from 034). created_by is
  // populated by the set_pre_approved_item_creator trigger; all writes go through the RPCs
  // so permission checks stay server-side.
  async function listPreApprovedItems(): Promise<PreApprovedItem[]> {
    return (ok(await db().from(TABLES.preApprovedItems).select('*').order('created_at', { ascending: false })) ?? []) as PreApprovedItem[]
  }
  // Approve a pending/on_hold line item AND upsert it into the catalog (keyed by lower(name)).
  // Returns the catalog row id.
  async function preApproveLineItem(lineItemId: string): Promise<string> {
    return ok(await db().rpc(RPCS.preApprove, { p_line_item_id: lineItemId })) as string
  }
  // Create a purchase request + line item directly from a catalog row (status 'approved',
  // pre_approved_item_id linked). `f` holds p_*-named order fields from draftToRpcPayload.
  async function orderPreApprovedItem(preApprovedItemId: string, f: Record<string, unknown>): Promise<string> {
    return ok(await db().rpc(RPCS.orderPreApproved, { p_pre_approved_id: preApprovedItemId, ...f })) as string
  }
  async function deletePreApprovedItem(id: string): Promise<void> {
    ok(await db().rpc(RPCS.deletePreApproved, { p_id: id }))
  }
  // Resolve line item ids -> "#<requestNo>-<lineNo>" refs (itemRef format) for the Records CSV
  // "Source Item" column. pre_approved_items.source_line_item_id has no FK, so it can't be
  // embedded in the query — read the rows directly (admin-only page, so full visibility is fine).
  async function lookupItemRefs(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return {}
    const rows = ok(await db().from(TABLES.lineItems)
      .select('id, line_no, purchase_requests!request_id(request_number)')
      .in('id', unique)) ?? []
    const map: Record<string, string> = {}
    for (const r of rows as { id: string; line_no: number | null; purchase_requests: { request_number: number | null } | null }[]) {
      if (r.purchase_requests?.request_number != null) map[r.id] = formatItemRef(r.purchase_requests.request_number, r.line_no)
    }
    return map
  }
```

**(h) Imports (top of file) — add the `formatItemRef` import on line 3 (merge into existing import block):**
```ts
import { formatItemRef } from '../lib/itemRef'
```
(Add as a new import line after line 3's `DEFAULT_RULES` import, keeping the existing `import { DEFAULT_RULES, type FormatRule } from '../formatting/rules'`.)

**(i) Return object (line 269) — add the 5 new functions (append to the returned object literal):**
```ts
  return { listRequests, getRequest, listLineItems, listLocations, listDepartments, listAllLocations, listAllDepartments, listFavorites, addFavorite, removeFavorite, submitRequest, submitRequestAnon, decideLineItem, orderLineItem, receiveLineItem, initiateReturn, processReturn, cancelLineItem, listLineItemsByStatus, listLineItemFacets, listAllLineItemsDetailed, countLineItems, setLineItemComment, deleteLineItem, archiveLineItem, createLocation, createDepartment, updateLocation, updateDepartment, fireNotification, captureAndNotify, getProductImageUrl, notifyApproved, notifyStatusUpdate, resolveUserNames, getFormattingRules, setFormattingRules, listShipToWorkers, createPurchaseOrder, listPurchaseOrders, closePurchaseOrder, listPreApprovedItems, preApproveLineItem, orderPreApprovedItem, deletePreApprovedItem, lookupItemRefs }
```

### Step 2: Verify

```bash
npm run build
npm test
```
Expected: build clean; **10 test files, 50 tests pass** (no new tests in this task).

### Step 3: Commit

```bash
git add src/data/db.ts
git commit -m "feat(pre-approved): db.ts - catalog list/order/pre-approve/delete + lookupItemRefs + reporting fields on line item types; v0.25.0"
```

---

---

## Task 4: Approvals UI — Pre-approved tab, Pre-approve action, New Purchase dialog (TDD)

**Files:**
- Create: `src/approvals/preApproved.ts` (pure helpers)
- Create: `src/approvals/preApproved.test.ts` (vitest)
- Create: `src/approvals/PreApprovedTab.tsx`
- Modify: `src/pages/ApprovalsPage.tsx` (5 edits)

**Interfaces:**
- Consumes: `api.listPreApprovedItems()`, `api.preApproveLineItem(id)`, `api.orderPreApprovedItem(id, f)`, `api.deletePreApprovedItem(id)` (Task 3); `PreApprovedItem`, `Location`, `Department` types (Task 3); `Modal` (`title`, `onClose`, `children`); `DateInput` (`value`, `onChange`, `className`); `PERMS`; `useAppPermissions`; `useToast` (from `@elasticit-llc/app-bridge`).
- Produces: `PreApprovedOrderDraft` shape, `prefillFromCatalog(item)`, `draftToRpcPayload(draft)`, `OTHER` sentinel (`'__other__'`), `PreApprovedTab` component.

### Step 1: Write the failing tests — `src/approvals/preApproved.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { prefillFromCatalog, draftToRpcPayload, OTHER, type PreApprovedOrderDraft } from './preApproved'
import type { PreApprovedItem } from '../data/db'

const catalogItem: PreApprovedItem = {
  id: 'cat-1',
  name: 'Standing Desks',
  item_url: 'https://example.com/desk',
  quantity: 4,
  substitution_ok: true,
  date_needed: '2026-09-15',
  memo: 'Second floor',
  location_id: 'loc-1',
  custom_location: null,
  department_id: 'dept-1',
  custom_department: null,
  created_by: 'user-1',
  created_at: '2026-08-20T12:00:00.000Z',
  source_line_item_id: 'li-9',
}

function draft(partial: Partial<PreApprovedOrderDraft> = {}): PreApprovedOrderDraft {
  return {
    name: 'Standing Desks',
    item_url: 'https://example.com/desk',
    quantity: 4,
    substitution_ok: true,
    date_needed: '2026-09-15',
    memo: 'Second floor',
    ship_to_name: 'Jane Doe',
    location_id: 'loc-1',
    custom_location: '',
    department_id: 'dept-1',
    custom_department: '',
    ...partial,
  }
}

describe('prefillFromCatalog', () => {
  it('prefills every editable field from the catalog entry; ship-to starts empty', () => {
    expect(prefillFromCatalog(catalogItem)).toEqual({
      name: 'Standing Desks',
      item_url: 'https://example.com/desk',
      quantity: 4,
      substitution_ok: true,
      date_needed: '2026-09-15',
      memo: 'Second floor',
      ship_to_name: '',
      location_id: 'loc-1',
      custom_location: '',
      department_id: 'dept-1',
      custom_department: '',
    })
  })

  it('falls back to empty defaults when there is no catalog entry', () => {
    expect(prefillFromCatalog(null)).toEqual({
      name: '', item_url: '', quantity: 1, substitution_ok: false, date_needed: '', memo: '',
      ship_to_name: '', location_id: '', custom_location: '', department_id: '', custom_department: '',
    })
  })

  it('selects the Other sentinel when the catalog entry stored a custom location/department', () => {
    const d = prefillFromCatalog({
      ...catalogItem,
      location_id: null, custom_location: 'HQ Annex',
      department_id: null, custom_department: 'Facilities',
    })
    expect(d.location_id).toBe(OTHER)
    expect(d.custom_location).toBe('HQ Annex')
    expect(d.department_id).toBe(OTHER)
    expect(d.custom_department).toBe('Facilities')
  })
})

describe('draftToRpcPayload', () => {
  it('passes selected ids through and trims text fields', () => {
    expect(draftToRpcPayload(draft({ name: '  Standing Desks  ', memo: ' second floor ' }))).toEqual({
      p_name: 'Standing Desks',
      p_item_url: 'https://example.com/desk',
      p_quantity: 4,
      p_ship_to_name: 'Jane Doe',
      p_location_id: 'loc-1',
      p_custom_location: null,
      p_department_id: 'dept-1',
      p_custom_department: null,
      p_date_needed: '2026-09-15',
      p_memo: 'second floor',
      p_substitution_ok: true,
    })
  })

  it('maps the Other sentinel to null id + trimmed custom text', () => {
    const p = draftToRpcPayload(draft({
      location_id: OTHER, custom_location: '  Dock 2 ',
      department_id: OTHER, custom_department: 'Ops',
    }))
    expect(p.p_location_id).toBeNull()
    expect(p.p_custom_location).toBe('Dock 2')
    expect(p.p_department_id).toBeNull()
    expect(p.p_custom_department).toBe('Ops')
  })

  it('converts empty/whitespace-only strings to null', () => {
    const p = draftToRpcPayload(draft({ name: '   ', item_url: '  ', ship_to_name: '  ', memo: '', date_needed: '' }))
    expect(p.p_name).toBeNull()
    expect(p.p_item_url).toBeNull()
    expect(p.p_ship_to_name).toBeNull()
    expect(p.p_memo).toBeNull()
    expect(p.p_date_needed).toBeNull()
  })

  it('floors quantity and clamps to a minimum of 1', () => {
    expect(draftToRpcPayload(draft({ quantity: 0 })).p_quantity).toBe(1)
    expect(draftToRpcPayload(draft({ quantity: -5 })).p_quantity).toBe(1)
    expect(draftToRpcPayload(draft({ quantity: 2.9 })).p_quantity).toBe(2)
  })

  it('passes substitution_ok through unchanged', () => {
    expect(draftToRpcPayload(draft({ substitution_ok: true })).p_substitution_ok).toBe(true)
    expect(draftToRpcPayload(draft({ substitution_ok: false })).p_substitution_ok).toBe(false)
  })
})
```

Run: `npm test -- src/approvals/preApproved.test.ts`
Expected: **fails** — `Cannot find module './preApproved'` (file does not exist yet).

### Step 2: Implement `src/approvals/preApproved.ts`

```ts
import type { PreApprovedItem } from '../data/db'

export const OTHER = '__other__'

export interface PreApprovedOrderDraft {
  name: string
  item_url: string
  quantity: number
  substitution_ok: boolean
  date_needed: string
  memo: string
  ship_to_name: string
  location_id: string
  custom_location: string
  department_id: string
  custom_department: string
}

// Pre-fill the New Purchase dialog from a catalog entry (spec B3: all fields
// editable). ship_to_name is intentionally not stored on the catalog, so it
// always starts empty. A catalog entry stored with a custom location/department
// opens with the "Other" sentinel selected so the custom text is visible.
export function prefillFromCatalog(item: PreApprovedItem | null): PreApprovedOrderDraft {
  return {
    name: item?.name ?? '',
    item_url: item?.item_url ?? '',
    quantity: item?.quantity ?? 1,
    substitution_ok: item?.substitution_ok ?? false,
    date_needed: item?.date_needed ?? '',
    memo: item?.memo ?? '',
    ship_to_name: '',
    location_id: item?.location_id ?? (item?.custom_location ? OTHER : ''),
    custom_location: item?.custom_location ?? '',
    department_id: item?.department_id ?? (item?.custom_department ? OTHER : ''),
    custom_department: item?.custom_department ?? '',
  }
}

// Maps the dialog draft to the exact p_* arguments of order_pre_approved_item.
// Empty/whitespace-only text becomes null so the RPC falls back to catalog
// values (name/url) or stores NULL (the rest).
export function draftToRpcPayload(d: PreApprovedOrderDraft): Record<string, unknown> {
  const trimOrNull = (s: string) => (s.trim() === '' ? null : s.trim())
  const isLocOther = d.location_id === OTHER
  const isDeptOther = d.department_id === OTHER
  return {
    p_name: trimOrNull(d.name),
    p_item_url: trimOrNull(d.item_url),
    p_quantity: Math.max(1, Math.floor(d.quantity || 0)),
    p_ship_to_name: trimOrNull(d.ship_to_name),
    p_location_id: isLocOther ? null : d.location_id || null,
    p_custom_location: isLocOther ? trimOrNull(d.custom_location) : null,
    p_department_id: isDeptOther ? null : d.department_id || null,
    p_custom_department: isDeptOther ? trimOrNull(d.custom_department) : null,
    p_date_needed: d.date_needed || null,
    p_memo: trimOrNull(d.memo),
    p_substitution_ok: d.substitution_ok,
  }
}
```

Run: `npm test -- src/approvals/preApproved.test.ts`
Expected: **8 tests pass**.

### Step 3: Create `src/approvals/PreApprovedTab.tsx`

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@elasticit-llc/app-bridge'
import { useAppPermissions } from '../lib/useAppPermissions'
import { useProcurementApi, PreApprovedItem, Location, Department } from '../data/db'
import { PERMS, formatDate } from '../lib/constants'
import { Modal } from '../components/Modal'
import { DateInput } from '../components/DateInput'
import { prefillFromCatalog, draftToRpcPayload, OTHER, type PreApprovedOrderDraft } from './preApproved'

const inputClass = 'w-full rounded-md border border-input bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring'

export function PreApprovedTab() {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()

  const isAdmin = hasAppPermission(PERMS.admin)
  const canOrder = hasAppPermission(PERMS.purchase) || hasAppPermission(PERMS.approve) || isAdmin

  const [items, setItems] = useState<PreApprovedItem[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orderFor, setOrderFor] = useState<PreApprovedItem | null>(null)
  const [form, setForm] = useState<PreApprovedOrderDraft | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [catalog, locs, depts] = await Promise.all([
        api.listPreApprovedItems(),
        api.listLocations(),
        api.listDepartments(),
      ])
      setItems(catalog)
      setLocations(locs)
      setDepartments(depts)
      setNames(await api.resolveUserNames(catalog.map((i) => i.created_by).filter((x): x is string => !!x)))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load pre-approved items')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  function locName(item: PreApprovedItem): string {
    const loc = item.location_id ? locations.find((l) => l.id === item.location_id) : undefined
    return loc?.name || item.custom_location || '—'
  }

  function deptName(item: PreApprovedItem): string {
    const dept = item.department_id ? departments.find((d) => d.id === item.department_id) : undefined
    return dept?.name || item.custom_department || '—'
  }

  function openOrderDialog(item: PreApprovedItem) {
    setOrderFor(item)
    setForm(prefillFromCatalog(item))
  }

  function updateForm(patch: Partial<PreApprovedOrderDraft>) {
    setForm((f) => (f ? { ...f, ...patch } : f))
  }

  const locIsOther = form?.location_id === OTHER
  const deptIsOther = form?.department_id === OTHER
  const canSubmit = !!form
    && form.name.trim() !== ''
    && (form.location_id === OTHER ? form.custom_location.trim() !== '' : form.location_id !== '')
    && (form.department_id === OTHER ? form.custom_department.trim() !== '' : form.department_id !== '')

  async function handleOrderSubmit() {
    if (!orderFor || !form) return
    setSubmitting(true)
    try {
      await api.orderPreApprovedItem(orderFor.id, draftToRpcPayload(form))
      showToast({ message: 'Order created — see Ready for Purchasing', type: 'success' })
      setOrderFor(null)
      setForm(null)
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to create order', type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(item: PreApprovedItem) {
    if (!window.confirm(`Remove "${item.name}" from the pre-approved catalog?`)) return
    try {
      await api.deletePreApprovedItem(item.id)
      showToast({ message: 'Removed from catalog', type: 'success' })
      await load()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to remove item', type: 'error' })
    }
  }

  return (
    <div className="grid gap-4">
      {loading && <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>}

      {!loading && error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No pre-approved items yet. Use "Pre-approve" on a pending item to add one.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Ship-to</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2 font-medium">Added by</th>
                <th className="px-3 py-2 font-medium">Added</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{item.name}</span>
                    {item.item_url && (
                      <a href={item.item_url} target="_blank" rel="noreferrer" className="block text-xs text-primary underline break-all">
                        {item.item_url}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{item.quantity}</td>
                  <td className="px-3 py-2 text-muted-foreground">{locName(item)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{deptName(item)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{item.created_by ? names[item.created_by] || 'Unknown' : '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(item.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      {canOrder && (
                        <button
                          type="button"
                          onClick={() => openOrderDialog(item)}
                          className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          New Purchase
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleRemove(item)}
                          className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/25"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {orderFor && form && (
        <Modal title={`New Purchase — ${orderFor.name}`} onClose={() => { setOrderFor(null); setForm(null) }}>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Item name</label>
              <input type="text" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} className={inputClass} />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Item URL</label>
              <input type="text" value={form.item_url} onChange={(e) => updateForm({ item_url: e.target.value })} placeholder="https://…" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Quantity</label>
                <input type="number" min={1} step={1} value={form.quantity} onChange={(e) => updateForm({ quantity: Number(e.target.value) })} className={inputClass} />
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Date needed</label>
                <DateInput value={form.date_needed} onChange={(v) => updateForm({ date_needed: v })} className={inputClass} />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Ship-to name</label>
              <input type="text" value={form.ship_to_name} onChange={(e) => updateForm({ ship_to_name: e.target.value })} placeholder="Optional" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Location</label>
                <select value={form.location_id} onChange={(e) => updateForm({ location_id: e.target.value })} className={inputClass}>
                  <option value="">— Select location —</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                  <option value={OTHER}>Other</option>
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Department</label>
                <select value={form.department_id} onChange={(e) => updateForm({ department_id: e.target.value })} className={inputClass}>
                  <option value="">— Select department —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value={OTHER}>Other</option>
                </select>
              </div>
            </div>
            {locIsOther && (
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Custom location</label>
                <input type="text" value={form.custom_location} onChange={(e) => updateForm({ custom_location: e.target.value })} placeholder="Enter location" className={inputClass} />
              </div>
            )}
            {deptIsOther && (
              <div className="grid gap-1">
                <label className="text-xs font-medium text-foreground">Custom department</label>
                <input type="text" value={form.custom_department} onChange={(e) => updateForm({ custom_department: e.target.value })} placeholder="Enter department" className={inputClass} />
              </div>
            )}
            <div className="grid gap-1">
              <label className="text-xs font-medium text-foreground">Memo</label>
              <textarea rows={2} value={form.memo} onChange={(e) => updateForm({ memo: e.target.value })} placeholder="Optional…" className={`${inputClass} resize-none`} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={form.substitution_ok} onChange={(e) => updateForm({ substitution_ok: e.target.checked })} className="h-4 w-4 accent-primary" />
              Substitution OK
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canSubmit || submitting}
                onClick={handleOrderSubmit}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create Order'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => { setOrderFor(null); setForm(null) }}
                className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default PreApprovedTab
```

### Step 4: Wire into `src/pages/ApprovalsPage.tsx`

**(a) Import** — after line 6 (`import { FavoritesTab } from '../purchasing/FavoritesTab'`):
```ts
import { PreApprovedTab } from '../approvals/PreApprovedTab'
```

**(b) Tab state (line 22)** — replace:
```ts
  const [tab, setTab] = useState<'items' | 'favorites'>('items')
```
with:
```ts
  const [tab, setTab] = useState<'items' | 'preapproved' | 'favorites'>('items')
```

**(c) Tab bar (lines 82–97)** — replace the two-button block with three buttons. Label of the first tab is "For Approval" (post-Wave A naming; if Wave A's rename is not yet merged into this branch, apply that rename here as well):
```tsx
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('items')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'items' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          For Approval
        </button>
        <button
          type="button"
          onClick={() => setTab('preapproved')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'preapproved' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Pre-approved
        </button>
        <button
          type="button"
          onClick={() => setTab('favorites')}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === 'favorites' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Favorite Items
        </button>
      </div>
```

**(d) `handlePreApprove`** — insert after the `handleAction` function (line 63):
```ts
  async function handlePreApprove(item: LineItemWithRequest) {
    if (!window.confirm(`Pre-approve "${item.item_description || 'this item'}"?\nIt will be approved and added to the pre-approved catalog.`)) return
    const reqId = item.request?.id
    setBusyId(item.id)
    try {
      await api.preApproveLineItem(item.id)
      showToast({ message: 'Item pre-approved', type: 'success' })
      api.fireNotification('item_approved', reqId, [item.id])
      const remaining = await api.listLineItemsByStatus(['pending', 'on_hold'])
      setItems(remaining)
      if (reqId && !remaining.some((it) => it.request.id === reqId)) await api.notifyApproved(reqId)
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Pre-approve failed', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }
```

**(e) Pre-approve button** — insert immediately after the Approve button's closing `</button>` (line 212), inside the existing action-buttons `<div>`:
```tsx
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handlePreApprove(item)}
              className="inline-flex items-center rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
            >
              Pre-approve
            </button>
```
(The whole Approvals page is already gated by `approvals/act` at the top of the component, so no extra permission check is needed on the button.)

**(f) Tab render** — before line 233 (`{tab === 'favorites' && <FavoritesTab />}`) add:
```tsx
      {tab === 'preapproved' && <PreApprovedTab />}
```

### Step 5: Verify

```
npm test
npm run build
```
Expected: 11 test files, 58 tests pass; build clean.

### Step 6: Commit

```
git add src/approvals/preApproved.ts src/approvals/preApproved.test.ts src/approvals/PreApprovedTab.tsx src/pages/ApprovalsPage.tsx
git commit -m "feat(pre-approved): Approvals page - Pre-approved tab (catalog + New Purchase dialog), Pre-approve action on item cards; v0.25.0"
```

---

---

## Task 5: Records page — CSV export gains Received / Cancelled / Pre-approved Item / Source Item

**Files:**
- Modify: `src/records/RecordsPage.tsx`

**Context:** Spec B4: "Records page CSV export extended with: received_at, cancelled_at, pre-approved item name, source item ref." The catalog id on each row (`item.pre_approved_item_id`) is resolved to the catalog row in `load()`; the catalog's `source_line_item_id` has no FK, so it is resolved to `#<req>-<line>` refs via `api.lookupItemRefs` (Task 3).

### Step 1: Apply the 4 edits

**(a) Import (line 4)** — replace:
```ts
import { useProcurementApi, LineItemDetailed, LineItemWithRequest } from '../data/db'
```
with:
```ts
import { useProcurementApi, LineItemDetailed, LineItemWithRequest, PreApprovedItem } from '../data/db'
```

**(b) `exportCsv` (lines 23–51)** — replace the whole function with:
```ts
function exportCsv(rows: LineItemDetailed[], catalog: Record<string, PreApprovedItem>, sourceRef: Record<string, string>) {
  const headers = ['Submitted', 'Requester', 'Email', 'Item', 'Qty', 'Location', 'Department', 'Status', 'Date Needed', 'ETA', 'Request Notes', 'Admin Comment', 'Received', 'Cancelled', 'Pre-approved Item', 'Source Item']
  const lines = [headers.join(',')]
  for (const item of rows) {
    const cat = item.pre_approved_item_id ? catalog[item.pre_approved_item_id] : undefined
    const sourceRefValue = cat?.source_line_item_id ? sourceRef[cat.source_line_item_id] ?? '' : ''
    lines.push([
      formatDate(item.request.submitted_at),
      item.request.requester_name ?? '',
      item.request.requester_email ?? '',
      item.item_description ?? '',
      String(item.quantity),
      locationName(item),
      departmentName(item),
      item.status.replace(/_/g, ' '),
      formatDate(item.date_needed),
      formatDate(item.eta),
      item.request.notes ?? '',
      item.admin_comment ?? '',
      formatDate(item.received_at),
      formatDate(item.cancelled_at),
      item.preApproved?.name ?? '',
      sourceRefValue,
    ].map(c => csvCell(c)).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `procurement-records-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
```

**(c) State + `load` (lines 63–86)** — add two state lines after `const [showArchived, setShowArchived] = useState(false)` (line 70):
```ts
  const [catalog, setCatalog] = useState<Record<string, PreApprovedItem>>({})
  const [sourceRef, setSourceRef] = useState<Record<string, string>>({})
```
and inside `load`'s `try`, after `setNames(map)` (line 80), add:
```ts
      const list = await api.listPreApprovedItems()
      setCatalog(Object.fromEntries(list.map(i => [i.id, i])))
      setSourceRef(await api.lookupItemRefs(list.map(i => i.source_line_item_id).filter((x): x is string => !!x)))
```

**(d) Export button (line 152)** — replace:
```ts
            onClick={() => exportCsv(items)}
```
with:
```ts
            onClick={() => exportCsv(items, catalog, sourceRef)}
```

### Step 2: Verify

```
npm run build
npm test
```
Expected: build clean; **11 test files, 58 tests pass** (unchanged count — no new tests; the CSV is a browser-side DOM side effect, covered by the manual QA step in Task 8).

### Step 3: Commit

```
git add src/records/RecordsPage.tsx
git commit -m "feat(records): CSV export adds Received, Cancelled, Pre-approved Item, Source Item columns; v0.25.0"
```

---

## Task 6: `docs/reports.md` — line_items fact-table reporting reference

**Files:**
- Create: `docs/reports.md`

### Step 1: Write the file

`docs/reports.md`:

```markdown
# Procurement reporting queries

`app_procurement.line_items` is the **per-item-order fact table**: one row per item order,
whether it came from a new request or a pre-approved re-order (see
`docs/superpowers/specs/2026-08-27-phase3-design.md`, B4). After Wave B (v0.25.0) every
lifecycle stage has a timestamp, so the client can run requested/ordered/re-ordered reports
against one table.

## Stage → source column

| Stage | Source |
|---|---|
| Requested | `line_items.created_at` / `purchase_requests.submitted_at` |
| Decision (approve/decline/hold) | `line_items.approval_date` (stamped for all decisions) |
| Ordered | `line_items.date_purchased` + `purchase_orders` (PO #, vendor, ETA) via `line_items.po_id` |
| Received | `line_items.received_at` |
| Returned | `line_items.return_date` → processed: `return_processed_at` |
| Cancelled / archived | `line_items.cancelled_at` / `line_items.archived_at` |
| Re-order linkage | `line_items.pre_approved_item_id` → catalog; `pre_approved_items.source_line_item_id` → original item |

> **Backfill gap:** `received_at` / `cancelled_at` only exist for rows stamped after the
> migration (v0.25.0). For those two stages, historical rows can be approximated with
> `updated_at`/`eta` and `status` respectively. `approval_date` and `date_purchased` are
> fully historical.

## Example queries (run via `supabase db query "<sql>" --linked`)

### 1. All items ever requested

```sql
SELECT li.created_at AS requested_at,
       pr.request_number,
       pr.requester_name,
       li.item_description,
       li.quantity,
       li.status
FROM app_procurement.line_items li
JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id
ORDER BY li.created_at;
```

### 2. All items ordered (with PO)

```sql
SELECT li.date_purchased AS ordered_at,
       po.po_number,
       po.vendor,
       po.eta,
       li.item_description,
       li.quantity
FROM app_procurement.line_items li
JOIN app_procurement.purchase_orders po ON po.id = li.po_id
WHERE li.po_id IS NOT NULL
ORDER BY li.date_purchased DESC NULLS LAST;
```

### 3. Re-order count per pre-approved item

```sql
SELECT cat.name,
       count(*)::int AS order_count,
       min(li.created_at) AS first_order,
       max(li.created_at) AS last_order
FROM app_procurement.pre_approved_items cat
JOIN app_procurement.line_items li ON li.pre_approved_item_id = cat.id
GROUP BY cat.name
ORDER BY order_count DESC;
```

### 4. Items requested but never ordered (with age)

```sql
SELECT li.created_at AS requested_at,
       pr.request_number,
       li.item_description,
       li.status,
       (now() - li.created_at) AS age
FROM app_procurement.line_items li
JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id
WHERE li.status IN ('pending', 'approved', 'on_hold')
ORDER BY li.created_at;
```

## Records CSV

The admin Records page "Export CSV" button includes the reporting columns
`Received`, `Cancelled`, `Pre-approved Item`, and `Source Item` (the `#<requestNo>-<lineNo>`
reference of the line item a catalog entry was pre-approved from).
```

### Step 2: Commit

```
git add docs/reports.md
git commit -m "docs: reports.md - line_items fact-table reporting queries + stage reference; v0.25.0"
```

---

## Task 7: Version bump to 0.25.0

**Files:**
- Modify: `package.json` (line 3)
- Modify: `app.manifest.json` (line 6)

### Step 1: Prerequisite check

```
git log --oneline -5
node -e "console.log(require('./package.json').version)"
```

**If the version is still `0.23.4`**, the Wave A (v0.24.0) merge is not in this branch —
**STOP** and land Wave A first (per the plan prerequisite). Wave B must build on the
Wave A branch state (e.g. the "For Approval" tab label from A2).

### Step 2: Bump both files

`package.json` line 3: `"version": "0.24.0"` → `"version": "0.25.0"`.
`app.manifest.json` line 6: `"version": "0.24.0"` → `"version": "0.25.0"`.

### Step 3: Verify

```
node -e "console.log(require('./package.json').version)"
node -e "console.log(require('./app.manifest.json').version)"
```
Expected: both print `0.25.0`.

### Step 4: Commit

```
git add package.json app.manifest.json
git commit -m "chore: bump to 0.25.0 (pre-approved items + reporting enrichment); v0.25.0"
```

---

## Task 8: Packaging, push, deploy, manual QA

**Files:** none (build output `dist/` is gitignored).

### Step 1: Full verification

```
npm test
npm run build
```
Expected: 11 test files, 58 tests pass; build clean.

### Step 2: Package the `.eitapp`

```
npm run package
```
Expected: `dist/procurement-0.25.0.eitapp` created.

### Step 3: Remove stale artifacts

Per the repo process rule, only the current version's artifact may remain in `dist/`:

```
Get-ChildItem dist\*.eitapp | Where-Object Name -ne 'procurement-0.25.0.eitapp' | Remove-Item
```
Verify: `Get-ChildItem dist\*.eitapp` lists exactly `procurement-0.25.0.eitapp`.

### Step 4: Push the branch

```
git status --short
git push origin for-qa
```
`git status` must be clean before pushing (nothing uncommitted).

### Step 5: Deploy to the QA portal

Upload `dist/procurement-0.25.0.eitapp` to the Mainspring QA portal (Supabase `qa`
branch). `publish-app` re-applies manifest migrations from the last saved version —
migrations 033/034 are idempotent, so a re-publish after any QA DB reset is safe.

### Step 6: Manual QA checklist (per the repo QA handover format)

Test accounts: an **admin**, an **approver** (holds `approvals/act` only), a
**purchaser** (holds `purchasing/manage` only), and a **requester**.

1. **Pre-approve flow (approver):** Approvals → For Approval tab → pick a pending item →
   "Pre-approve" → confirm dialog → item leaves the queue (card removed), toast
   "Item pre-approved".
2. **Catalog entry:** Approvals → Pre-approved tab shows the item with name, URL, qty,
   ship-to/department, "Added by" = approver's name, added date.
3. **Case-insensitive upsert:** pre-approve a second pending item whose name differs only
   in case/spelling-normalization (e.g. "Standing Desks" vs "standing desks") → catalog
   still has ONE row (unique on `lower(name)`), its `source_line_item_id` updated to the
   newer item.
4. **New Purchase flow (purchaser):** Pre-approved tab → "New Purchase" on a row → dialog
   pre-filled (name/URL/qty/substitution/date/memo/location/department) → change qty,
   switch department to "Other" + custom text, clear ship-to → "Create Order" → toast
   "Order created — see Ready for Purchasing" → Purchasing → Ready for Purchasing shows
   the new item already approved under a **new request number**.
5. **Place Order on it:** existing Place Order flow works unchanged (date purchased, ETA,
   shipping location, PO creation) — item moves to Ordered/Closed Orders as usual.
6. **Received stamp:** mark the item received → verify in the DB:
   `SELECT status, received_at FROM app_procurement.line_items WHERE id = '<id>'`
   → `received` + non-null `received_at`.
7. **Cancelled stamp:** approve another pending item, then cancel it from Purchasing →
   verify `status='cancelled'` and non-null `cancelled_at`.
8. **Admin Remove:** admin → Pre-approved tab → "Remove" on a row → confirm → row gone;
   existing line items that referenced it still load with the pre-approved column blank
   (FK `ON DELETE SET NULL`).
9. **Reporting:** run the four queries from `docs/reports.md` via the portal DB console;
   query 3 returns the catalog item with `order_count ≥ 1` after step 4/5.
10. **CSV:** admin → Records → Export CSV → file contains the four new columns
    (`Received`, `Cancelled`, `Pre-approved Item`, `Source Item`), populated for the rows
    from steps 4–7 (Source Item = `#<reqNo>-<lineNo>` of the item that was pre-approved).
11. **Permissions:** purchaser does NOT see "Pre-approve" on item cards and cannot call
    `pre_approve_line_item` (server rejects with `Not permitted to pre-approve`);
    requester sees the Approvals page as before (no Pre-approved tab — page is
    approver-gated); a non-admin does NOT see "Remove".

### QA handover text (paste into the ClickUp task)

**What changed & why:** v0.25.0 adds the pre-approved items catalog (Approvals →
Pre-approved tab): approvers can pre-approve a pending item (approves it AND saves it as
a standing catalog entry); admin/approver/purchaser can re-order catalog items via
"New Purchase" (creates a new request that lands directly in Ready for Purchasing).
Records CSV gains Received / Cancelled / Pre-approved Item / Source Item columns, and
`docs/reports.md` documents the line_items fact-table reporting queries.

**Expected behavior:** checklist items 1–11 above, each a pass/fail statement.

**How to test it:** Mainspring QA portal (Supabase `qa` branch), admin/approver/
purchaser/requester accounts as above; steps per checklist item.

---

## Appendix A — Spec coverage map

| Spec (2026-08-27-phase3-design.md) | Plan task |
|---|---|
| B1 — `pre_approved_items` table + RLS + created_by trigger; `line_items` reporting columns | Task 1 (migration 033) |
| B2 — `pre_approve_line_item`, `order_pre_approved_item`, `delete_pre_approved_item`; `receive_line_item` v2; `cancel_line_item` v3 | Task 2 (migration 034) |
| B2/DB wiring — client API for the new table + RPCs, reporting fields on `LineItemRow`/`LineItemDetailed` | Task 3 (`db.ts`) |
| B3 — Pre-approved tab, Pre-approve action, New Purchase dialog | Task 4 (UI + helpers) |
| B4 — `docs/reports.md` queries; Records CSV columns | Tasks 5 + 6 |
| Version → v0.25.0 | Task 7 |
| Packaging, artifact cleanup, branch push, QA deploy + handover | Task 8 |

## Appendix B — Spec ambiguities found and how they were resolved

1. **`order_pre_approved_item` signature vs. dialog fields.** Spec B2 lists
   `order_pre_approved_item(p_pre_approved_id, p_quantity, p_ship_to_name, p_location_id, …)`
   with **no** `p_name`/`p_item_url`, but spec B3 requires the New Purchase dialog to
   pre-fill **and allow editing** the item name and URL. Resolution: the RPC accepts two
   extra parameters `p_name text, p_item_url text`; NULL/empty values fall back to the
   catalog row's `name`/`item_url` (`coalesce(nullif(trim(p_name), ''), v_cat_name)`).
   Noted in the migration 034 header comment.
2. **Wave A not yet merged.** The repo is at v0.23.4 + the spec commit; Wave A (v0.24.0,
   including the "For Approval" tab rename from A2) is not in `for-qa` yet. Resolution:
   the plan declares "Wave A merged into `for-qa`" as a global prerequisite, uses the
   post-Wave-A tab label, and Task 7 **stops** if the version is still 0.23.4.
3. **MCP cannot see the QA Supabase project.** `jkbqaxpfvqbeepwhunhl` is not in the MCP
   project list (likely a branch DB). Resolution: verified that the Supabase CLI
   (`supabase db query … --linked`, linked from the repo) reaches the same project, and
   the plan uses the CLI throughout with a preflight sanity check (36 `line_items` rows,
   no catalog table) before applying migrations.
4. **`cancel_line_item` base version.** Migration 022 (the current one) intentionally
   dropped the `approved_by` stamp that 017 set. Resolution: v3 is 022's body +
   `cancelled_at = now()` only — no behavior changes beyond the new stamp.
5. **Pre-approve button visibility.** Spec B3 says "visible to `approvals/act` holders".
   The whole Approvals page already returns early for non-holders, so the button is
   rendered unconditionally inside the page (the server-side RPC enforces the permission
   regardless).
6. **`p_ship_to_name` storage.** The spec never says where ship-to is stored on the
   created line item; `line_items` already has a `ship_to_name text` column (migration
   001, used by all `submit_request*` RPCs), so the new item stores it there.
7. **RLS verification limits.** The CLI session has no JWT, so `auth.uid()` is NULL and
   `check_user_permission` returns false for it — positive permission paths cannot be
   exercised via CLI. Resolution: structural checks (`pg_policies` rows, RPC grants) +
   negative permission tests via CLI + positive checks in the portal (QA checklist 11).
