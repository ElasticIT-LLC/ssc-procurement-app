# Wave C — History Timeline, Comment Threads, 14-Day Reminder (v0.26.0) Implementation Plan

**Required sub-skill:** superpowers:writing-plans — invoked at session start; this document is its output.
**Spec (authoritative):** `docs/superpowers/specs/2026-08-27-phase3-design.md` (Wave C sections: C1 lines 134-144, C2 lines 146-206, C3 lines 208-217, Testing lines 221-225, Rollout lines 227-231, Risks lines 242-246)
**Date:** 2026-08-27 · **Branch:** `for-qa` · **QA Supabase project:** `jkbqaxpfvqbeepwhunhl` (CLI-linked)

## Goal

Ship Phase 3 Wave C of the procurement app as **v0.26.0**:
- **C1** per-request item **history timeline** (derived, no event log)
- **C2** per-request **comment threads** (requester + staff, emails + in-app bells + realtime, @mentions)
- **C3** **14-day overdue reminder** (pg_cron daily 08:00 → edge function → branded email + bell)

## Architecture

- **Schema mode** Supabase, schema `app_procurement`. New table `request_comments` (immutable threads: no authenticated UPDATE/DELETE policies; INSERT only via SECURITY DEFINER RPC).
- **Authoritative base state (verified on QA 2026-08-27):** repo at v0.23.4, migrations 001-032 applied (Wave A/B NOT yet applied — no `pre_approved_items`, no `last_overdue_reminder_at`). `line_items` has NO `received_at`/`cancelled_at` columns (spec C1 line 138 lists them; they do not exist — see Decisions D3). `submit_request` final = migration 018 (v4, `(p_notes text, p_line_items jsonb) RETURNS uuid`). `submit_request_anon` final = 024 (v5, `(p_line_items jsonb, p_notes text, p_requester_email text, p_requester_name text DEFAULT NULL) RETURNS uuid`). `order_line_item` final = 021 (`(p_line_item_id, p_date_purchased, p_eta, p_shipping_location_id, p_custom_shipping_location, p_purchase_notes) RETURNS void`). RLS email fallback = 027 pattern `COALESCE(NULLIF(auth.jwt()->>'email',''), up.email)`.
- **Edge function** `procurement-capture-and-notify` (verify_jwt: false, holds service-role key in edge runtime env) gains two events: `comment_added` (bell + email per spec email-rules table) and `overdue_reminder` (fired by pg_cron).
- **Shell realtime** already publishes `public.notifications`; migration 035 adds `app_procurement.request_comments` to the `supabase_realtime` publication (DO-block guarded).
- **Client:** React/TS via app-bridge `useSupabase()`; new `RequestThread` + `RequestActivity` components; pure `timeline.ts`/`mentions.ts` libs with vitest tests.
- **No elasticit-shell changes. No inbound email. Threads immutable (v1).**

## Tech Stack

Supabase Postgres 15 + pg_cron 1.6.4 + pg_net 0.20.3 (all present on QA) · Deno edge functions (supabase-js v2) · React 19 + TypeScript 6 + Vite 8 · vitest 4 · HVE SMTP (smtp-hve.office365.com:587, sender from `client_settings.hve_sender_address`).

## Global Constraints

- Branch `for-qa`; every commit ends with `; v0.26.0` and follows repo Conventional Commit style (`type(scope): msg; vX.Y.Z`).
- Version: `0.23.4` → `0.26.0` in BOTH `app.manifest.json` (authoritative per CLAUDE.md) and `package.json`.
- Migrations are appended, NEVER edited. New files: `migrations/035_request_comments.sql`, `migrations/036_last_overdue_reminder_at.sql`, `migrations/037_overdue_cron.sql` (numbers 033/034 are reserved for Wave B).
- **Every DDL statement must be idempotent** (`IF NOT EXISTS` / `DROP IF EXISTS` / DO-block guards / NOT-EXISTS backfill guard) because each migration runs once via CLI on QA AND again via publish-app at `.eitapp` upload.
- SECURITY DEFINER functions: `SET search_path = app_procurement, public`, permission checks via `public.check_user_permission(auth.uid(), '<perm>')`, then `REVOKE ALL ... FROM PUBLIC[, anon]` + `GRANT EXECUTE ... TO authenticated, service_role` (repo pattern per 005/007/018/021/024 — NOT the internal-wrapper pattern; advisor lints 0028/0029 don't fire because anon cannot execute).
- RLS: `DROP POLICY IF EXISTS` + `CREATE POLICY` (no `CREATE OR REPLACE POLICY` exists).
- The shell's `auto_enable_app_rls` event trigger (elasticit-shell 011) fires on `CREATE TABLE` in `app_*` schemas and creates 5 permissive policies `app_procurement_<table>_{service,read,insert,update,delete}`. Migration 035 MUST drop and replace them after the CREATE TABLE.
- `request_comments` is NOT added to manifest `database.tables[]` (publish-app would then generate authenticated write policies, breaking immutability + insert-only-via-RPC).
- Comment bodies: 1-1000 chars (DB CHECK enforces).
- Notification keys fired to the bell use `event_type = 'procurement:<key>'`, `app_slug = 'procurement'`, rows inserted into `public.notifications (user_id, event_type, title, body, link, app_slug)`.
- Requests-page deep link pattern (used by all email/links): `{portal_url}/apps/{app_id}/requests?request={request_id}` where `portal_url` = `client_settings.portal_url` (QA: `https://qa.apps.mainspringrecovery.com`), `app_id` = row in `apps` where `slug='procurement'` (QA: `e5f487a8-9286-40ae-85fa-98747e9c19d8`).
- Edge function redeploys happen automatically on `.eitapp` upload (manifest `edge_functions[]` already lists it) — no separate deploy step.
- QA gate before packaging: `npm run validate` (manifest/source) + `npm test` (vitest) + `npm run build` (tsc) all pass.
- Packaging: `npm run package` → `dist/procurement-0.26.0.eitapp`; **delete any other `.eitapp` in `dist/`** (stale-artifact rule).
- Upload flow: Admin > App Management > upload `.eitapp` on the QA portal (publish-app re-applies migrations idempotently, redeploys the function, syncs the notifications catalog).
- The `supabase_vault` is NOT touched: per this repo's CLAUDE.md ("Never store a service-role JWT in a client-visible vault") and msr-overtime-dashboard-app v14 precedent, the cron call is **keyless** (see D1).

## Decisions & Spec Deviations (read before executing)

- **D1 — Cron auth is KEYLESS (deviation from spec C3 line 217).** Spec says "service-role JWT (stored in `supabase_vault`)". This repo's CLAUDE.md explicitly forbids storing service-role JWTs in a client-visible vault, and the overtime app dropped that exact pattern in v14 (security violation) in favor of keyless `net.http_post` to a `verify_jwt:false` function (v17). The function already holds its own service-role key in the edge runtime env, so a JWT on the cron POST adds no real authorization (the endpoint is open regardless); the triggered event is bounded, idempotent (14-day dedupe column) and best-effort. Decision: keyless POST, URL built at runtime from `app_procurement._config.supabase_url` (seeded by manifest `config[]` with `source: "project_url"` — environment-agnostic, works on QA and prod). If the team prefers the literal spec variant, swap the 037 command for a `vault.decrypted_secrets` lookup of a `service_role`-sourced manifest `vault_secrets[]` entry — but the deviation is recommended.
- **D2 — Auto-RLS survival.** Migration 035 drops the 5 trigger-created policies right after `CREATE TABLE` and creates: `..._service` (FOR ALL TO service_role) + `..._read` (FOR SELECT TO authenticated, request-scoped). No INSERT/UPDATE/DELETE policies for authenticated → thread immutability + RPC-only writes enforced at RLS.
- **D3 — `received_at` / `cancelled_at` do not exist** (spec C1 line 138 assumes them; spec Risk #3 admits receipts were never stamped). Timeline derives: "Marked received" ← `line_items.updated_at` when `status='received'` (stamped by `receive_line_item`); "Item cancelled" ← `line_items.updated_at` when `status='cancelled'`. Approximate timestamps; document in report docs.
- **D4 — `submit_request_anon` also posts notes as a thread comment** (spec names only `submit_request` v5, but the public form is the other "Request form" surface; author row: `author_id NULL`, `author_name = COALESCE(p_requester_name, p_requester_email)`, `author_role='requester'`, atomic in the same transaction).
- **D5 — Purchase-note threads are posted CLIENT-SIDE after the order RPC succeeds** (spec C2 surfaces table: "posted after the order RPC succeeds"). Bulk POs may span multiple requests → one `purchasing` comment per distinct request, `line_item_id NULL`, body includes the PO number. Only posted when notes are non-empty (empty notes → nothing to post; the timeline already shows the ordered event from `date_purchased`).
- **D6 — Mention picker data source.** `get_permission_holders` is service_role-only (005), so the client cannot list portal staff directly. New SECURITY DEFINER RPC `get_mention_candidates(p_request_id)` (granted to `authenticated`) inlines the 005 permission query and returns requester + this request's comment authors + staff with approvals/purchasing/admin permissions as `(user_id, display_name, email)`.
- **D7 — Double email on order is expected.** Placing an order fires the existing `item_ordered` email AND the new `comment_added` email (staff-started thread → requester), per the spec email-rules table taken literally. Verified behavior in QA checklist, not a bug.
- **D8 — Bell event types** `procurement:comment_added` and `procurement:request_overdue_reminder` are inserted directly by the edge function. `public.notifications.event_type` has no CHECK constraint (shell 035), so this is safe; they are intentionally NOT in the manifest catalog (comment_added has no opt-in — it's a direct counterpart notification; the overdue reminder IS cataloged for opt-in per spec).

## File Structure

| File | Action | Task |
|---|---|---|
| `migrations/035_request_comments.sql` | CREATE | 1, 2, 3 |
| `migrations/036_last_overdue_reminder_at.sql` | CREATE | 6 |
| `migrations/037_overdue_cron.sql` | CREATE | 7 |
| `supabase/functions/procurement-capture-and-notify/index.ts` | MODIFY | 5 |
| `supabase/functions/procurement-capture-and-notify/emails.ts` | MODIFY | 5 |
| `src/data/db.ts` | MODIFY | 4 |
| `src/lib/timeline.ts` | CREATE | 8 |
| `src/lib/mentions.ts` | CREATE | 8 |
| `src/lib/timeline.test.ts` | CREATE | 8 |
| `src/lib/mentions.test.ts` | CREATE | 8 |
| `src/components/RequestActivity.tsx` | CREATE | 8 |
| `src/components/RequestThread.tsx` | CREATE | 8 |
| `src/requester/RequestDetail.tsx` | MODIFY | 9 |
| `src/pages/ApprovalsPage.tsx` | MODIFY | 9 |
| `src/records/RecordsPage.tsx` | MODIFY | 10 |
| `src/purchasing/ReadyForPurchasing.tsx` | MODIFY | 10 |
| `src/purchasing/CreatePurchaseOrderForm.tsx` | MODIFY | 10 |
| `app.manifest.json` | MODIFY | 7, 8, 11 |
| `package.json` | MODIFY | 11 |
| `dist/` | BUILD + clean | 12 |
| `docs/superpowers/plans/2026-08-27-wave-c-comms-history.md` | CREATE (this file) | — |

## Tasks

### Task 1: Migration 035 — `request_comments` table, thread RLS, realtime, admin_comment backfill

**Files:**
- `migrations/035_request_comments.sql` (CREATE, new file — Task 2 and Task 3 append to it)

**Interfaces (produced):**
- Table `app_procurement.request_comments (id uuid PK, request_id uuid FK NOT NULL, parent_id uuid FK NULL, line_item_id uuid FK NULL, source text NOT NULL CHECK IN ('request','approvals','purchasing','request_notes'), author_id uuid NULL, author_name text NOT NULL, author_email text NULL, author_role text NOT NULL CHECK IN ('requester','staff'), body text NOT NULL CHECK char_length 1..1000, mentioned_user_ids uuid[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`
- Policies `app_procurement_request_comments_service` (FOR ALL TO service_role USING true WITH CHECK true), `app_procurement_request_comments_read` (FOR SELECT TO authenticated — see code). No other policies.
- `supabase_realtime` publication includes `app_procurement.request_comments`.

**Code** (write the file with exactly this content; Tasks 2-3 append below the backfill):

```sql
-- 035: Wave C (C2) — request comment threads.
-- New table request_comments (immutable threads: requesters + staff comment per request,
-- 1 level of replies). Thread-scoped RLS mirroring request visibility, realtime publication
-- entry, and one-time backfill of legacy line_items.admin_comment as 'approvals' roots.
-- Idempotent: safe to run via CLI and again via publish-app.
-- NOTE: the shell's auto_enable_app_rls event trigger creates permissive
-- app_procurement_request_comments_{service,read,insert,update,delete} policies at
-- CREATE TABLE time; we drop and replace them below (D2). Do NOT add this table to
-- manifest database.tables[] (publish-app would re-create authenticated write policies).

CREATE TABLE IF NOT EXISTS app_procurement.request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES app_procurement.purchase_requests(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES app_procurement.request_comments(id) ON DELETE CASCADE,
  line_item_id uuid REFERENCES app_procurement.line_items(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'request' CHECK (source IN ('request','approvals','purchasing','request_notes')),
  author_id uuid,
  author_name text NOT NULL,
  author_email text,
  author_role text NOT NULL CHECK (author_role IN ('requester','staff')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  mentioned_user_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_comments_request ON app_procurement.request_comments (request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_request_comments_parent ON app_procurement.request_comments (parent_id);

-- RLS: drop auto-trigger policies, create thread-scoped read + service full access only.
ALTER TABLE app_procurement.request_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_procurement_request_comments_service ON app_procurement.request_comments;
DROP POLICY IF EXISTS app_procurement_request_comments_read ON app_procurement.request_comments;
DROP POLICY IF EXISTS app_procurement_request_comments_insert ON app_procurement.request_comments;
DROP POLICY IF EXISTS app_procurement_request_comments_update ON app_procurement.request_comments;
DROP POLICY IF EXISTS app_procurement_request_comments_delete ON app_procurement.request_comments;

CREATE POLICY app_procurement_request_comments_service ON app_procurement.request_comments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY app_procurement_request_comments_read ON app_procurement.request_comments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM app_procurement.purchase_requests pr
      WHERE pr.id = request_comments.request_id
        AND (
          pr.requester_id = auth.uid()
          OR (pr.requester_id IS NULL
              AND pr.requester_email = (SELECT COALESCE(NULLIF(auth.jwt()->>'email',''), up.email)
                                        FROM public.user_profiles up WHERE up.id = auth.uid()))
          OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
          OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
          OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
        )
    )
  );

-- Realtime: add the table to the supabase_realtime publication (guarded).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'app_procurement' AND tablename = 'request_comments'
      ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE app_procurement.request_comments;
      END IF;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
  END IF;
END $$;

-- Backfill (decision 10): each legacy line_items.admin_comment becomes one thread root.
-- Idempotent: skips items that already have an 'approvals' comment with the same body.
INSERT INTO app_procurement.request_comments
  (request_id, parent_id, line_item_id, source, author_id, author_name, author_email, author_role, body, mentioned_user_ids, created_at)
SELECT
  li.request_id, NULL, li.id, 'approvals',
  li.commented_by,
  COALESCE(up.display_name, up.email, li.commented_by::text, 'Approver'),
  up.email,
  'staff',
  li.admin_comment,
  '{}'::uuid[],
  coalesce(li.commented_at, now())
FROM app_procurement.line_items li
LEFT JOIN public.user_profiles up ON up.id = li.commented_by
WHERE li.admin_comment IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM app_procurement.request_comments rc
    WHERE rc.request_id = li.request_id AND rc.line_item_id = li.id AND rc.source = 'approvals' AND rc.body = li.admin_comment
  );
```

**Apply to QA** (CLI-linked to `jkbqaxpfvqbeepwhunhl`; agent sessions may use the Supabase MCP `supabase_apply_migration` instead — same effect):

```
supabase psql -f migrations/035_request_comments.sql
```

Expected: no errors. (If the installed CLI deprecated `psql`, the equivalent is `supabase db execute` against the linked project.)

**Verify** (run each; agent sessions via Supabase MCP `supabase_execute_sql`):

```sql
SELECT count(*) AS tbl FROM app_procurement.request_comments;
-- Expected: 1 (QA has exactly one line_items row with non-null admin_comment)
SELECT policyname FROM pg_policies WHERE tablename = 'request_comments' ORDER BY policyname;
-- Expected: app_procurement_request_comments_read, app_procurement_request_comments_service (exactly 2)
SELECT count(*) AS realtime_rows FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'request_comments';
-- Expected: 1
```

**Commit:**
```
git add migrations/035_request_comments.sql
git commit -m "feat(db): request_comments table + thread RLS + realtime + admin_comment backfill; v0.26.0"
```

---

### Task 2: Migration 035 (cont.) — `post_request_comment` + `get_mention_candidates` RPCs

**Files:**
- `migrations/035_request_comments.sql` (APPEND at end of file)

**Interfaces (produced):**
- `app_procurement.post_request_comment(p_request_id uuid, p_parent_id uuid, p_line_item_id uuid, p_source text, p_body text, p_mentions text[]) RETURNS app_procurement.request_comments` — SECURITY DEFINER; EXECUTE: authenticated, service_role.
- `app_procurement.get_mention_candidates(p_request_id uuid) RETURNS TABLE (user_id uuid, display_name text, email text)` — SECURITY DEFINER; EXECUTE: authenticated, service_role.

**Code** (append to `migrations/035_request_comments.sql`):

```sql
-- post_request_comment: create a thread root or a 1-level reply.
-- Auth: requester of the request (portal user by uid, or email match for email-submission
-- requesters) OR staff holding approvals/act | purchasing/manage | admin/manage.
-- parent_id, when given, must be a ROOT (parent_id NULL) of the same request; replies may not
-- change line_item_id. Mentions are resolved case-insensitively against user_profiles
-- (display name, or email / email local part). Author snapshot from JWT + user_profiles
-- (same pattern as 007/018). Returns the inserted row.
CREATE OR REPLACE FUNCTION app_procurement.post_request_comment(
  p_request_id uuid,
  p_parent_id uuid,
  p_line_item_id uuid,
  p_source text,
  p_body text,
  p_mentions text[]
) RETURNS app_procurement.request_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_pr purchase_requests;
  v_parent request_comments;
  v_name text;
  v_email text;
  v_role text;
  v_mentions uuid[] := '{}';
  v_tok text;
  v_uid uuid;
  v_row request_comments;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to comment'; END IF;
  IF p_source NOT IN ('request','approvals','purchasing','request_notes') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;
  SELECT * INTO v_pr FROM purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;

  IF NOT (
    public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
    OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
    OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
    OR v_pr.requester_id = auth.uid()
    OR (v_pr.requester_id IS NULL
        AND v_pr.requester_email = (SELECT COALESCE(NULLIF(auth.jwt()->>'email',''), up.email)
                                    FROM public.user_profiles up WHERE up.id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Not permitted to comment';
  END IF;

  p_body := trim(coalesce(p_body, ''));
  IF char_length(p_body) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Comment must be 1-1000 characters';
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM request_comments WHERE id = p_parent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent comment not found'; END IF;
    IF v_parent.request_id <> p_request_id THEN RAISE EXCEPTION 'Parent comment is in another request'; END IF;
    IF v_parent.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Replies must point at a thread root'; END IF;
    IF p_line_item_id IS NOT NULL AND v_parent.line_item_id IS DISTINCT FROM p_line_item_id THEN
      RAISE EXCEPTION 'Reply must stay on the same item as its thread';
    END IF;
  END IF;

  IF p_line_item_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM line_items WHERE id = p_line_item_id AND request_id = p_request_id) THEN
      RAISE EXCEPTION 'Line item does not belong to this request';
    END IF;
  END IF;

  SELECT COALESCE(up.display_name, au.email, 'User'), COALESCE(up.email, au.email)
    INTO v_name, v_email
    FROM auth.users au
    LEFT JOIN public.user_profiles up ON up.id = au.id
    WHERE au.id = auth.uid();
  v_role := CASE
    WHEN public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
      OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
      OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN 'staff'
    ELSE 'requester'
  END;

  IF p_mentions IS NOT NULL THEN
    FOR v_tok IN SELECT u FROM unnest(p_mentions) AS u
    LOOP
      SELECT up.id INTO v_uid
        FROM public.user_profiles up
        WHERE up.email IS NOT NULL
          AND (lower(up.email) = lower(trim(v_tok))
               OR lower(regexp_replace(up.email, '@.*$', '')) = lower(regexp_replace(trim(v_tok), '@.*$', '')))
        OR lower(coalesce(up.display_name, '')) = lower(trim(v_tok))
        ORDER BY (lower(up.email) = lower(trim(v_tok))) DESC
        LIMIT 1;
      IF v_uid IS NOT NULL AND NOT (v_uid = ANY(v_mentions)) THEN
        v_mentions := array_append(v_mentions, v_uid);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO request_comments
    (request_id, parent_id, line_item_id, source, author_id, author_name, author_email, author_role, body, mentioned_user_ids)
  VALUES
    (p_request_id, p_parent_id, p_line_item_id, p_source, auth.uid(), v_name, v_email, v_role, p_body, v_mentions)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;
REVOKE ALL ON FUNCTION app_procurement.post_request_comment(uuid, uuid, uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_procurement.post_request_comment(uuid, uuid, uuid, text, text, text[]) TO authenticated, service_role;

-- get_mention_candidates: picker list = requester of this request + this request's comment
-- authors + staff holding any procurement act permission. get_permission_holders (005) is
-- service_role-only, so the permission query is inlined here (same body as 005).
CREATE OR REPLACE FUNCTION app_procurement.get_mention_candidates(p_request_id uuid)
RETURNS TABLE (user_id uuid, display_name text, email text)
LANGUAGE sql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
  SELECT DISTINCT x.user_id, x.display_name, x.email
  FROM (
    SELECT pr.requester_id AS user_id, up.display_name, up.email
      FROM purchase_requests pr
      LEFT JOIN public.user_profiles up ON up.id = pr.requester_id
     WHERE pr.id = p_request_id AND pr.requester_id IS NOT NULL
    UNION
    SELECT rc.author_id, up.display_name, up.email
      FROM request_comments rc
      LEFT JOIN public.user_profiles up ON up.id = rc.author_id
     WHERE rc.request_id = p_request_id AND rc.author_id IS NOT NULL
    UNION
    SELECT up.id, up.display_name, up.email
      FROM public.user_profiles up
     WHERE up.email IS NOT NULL AND up.email <> ''
       AND (public.check_user_permission(up.id, 'apps/procurement/approvals/act')
            OR public.check_user_permission(up.id, 'apps/procurement/purchasing/manage')
            OR public.check_user_permission(up.id, 'apps/procurement/admin/manage'))
  ) x
  WHERE x.user_id IS NOT NULL
  ORDER BY x.email
$fn$;
REVOKE ALL ON FUNCTION app_procurement.get_mention_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_procurement.get_mention_candidates(uuid) TO authenticated, service_role;
```

**Apply + verify** (re-run the whole file — idempotent):

```
supabase psql -f migrations/035_request_comments.sql
```

```sql
SELECT p.proname, pg_get_function_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app_procurement' AND p.proname IN ('post_request_comment','get_mention_candidates');
-- Expected: both rows present with the signatures above
```

**Commit:**
```
git add migrations/035_request_comments.sql
git commit -m "feat(db): post_request_comment + get_mention_candidates RPCs; v0.26.0"
```

---

### Task 3: Migration 035 (cont.) — `submit_request` v5 + `submit_request_anon` v6 (notes → first thread comment)

**Files:**
- `migrations/035_request_comments.sql` (APPEND at end of file)

**Interfaces (changed):**
- `app_procurement.submit_request(p_notes text, p_line_items jsonb) RETURNS uuid` — same signature as v4 (018); when `trim(p_notes)` is 1-1000 chars, additionally inserts a `request_comments` root row with `source='request_notes'` in the same transaction.
- `app_procurement.submit_request_anon(p_line_items jsonb, p_notes text, p_requester_email text, p_requester_name text DEFAULT NULL) RETURNS uuid` — same signature as v5 (024); same notes→comment insert, with `author_id NULL`, `author_name = COALESCE(p_requester_name, p_requester_email)` (D4).

**Code** (append to `migrations/035_request_comments.sql`):

```sql
-- submit_request (v5): Wave C — non-empty notes are also posted as the first thread
-- comment (source='request_notes'), atomic with the request insert. Signature unchanged
-- from v4 (018), so no client changes required.
CREATE OR REPLACE FUNCTION app_procurement.submit_request(p_notes text, p_line_items jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_id uuid;
  v_name text;
  v_email text;
  li jsonb;
  v_notes text;
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/requests/create') THEN
    RAISE EXCEPTION 'Not permitted to create requests';
  END IF;
  SELECT COALESCE(up.display_name, au.email), COALESCE(up.email, au.email)
    INTO v_name, v_email
    FROM auth.users au
    LEFT JOIN public.user_profiles up ON up.id = au.id
    WHERE au.id = auth.uid();
  INSERT INTO purchase_requests
    (requester_id, requester_name, requester_email, requester_type, submission_source, status, notes, submitted_at)
  VALUES (auth.uid(), v_name, v_email, 'portal_user', 'in_portal', 'pending', p_notes, now())
  RETURNING id INTO v_id;
  FOR li IN SELECT * FROM jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) LOOP
    INSERT INTO line_items
      (request_id, ship_to_name, location_id, custom_location, department_id, custom_department,
       item_url, item_description, memo, quantity, substitution_ok, date_needed, status)
    VALUES (v_id, li->>'ship_to_name', nullif(li->>'location_id','')::uuid, li->>'custom_location',
            nullif(li->>'department_id','')::uuid, li->>'custom_department', li->>'item_url',
            li->>'item_description', li->>'memo', coalesce((li->>'quantity')::int, 1),
            coalesce((li->>'substitution_ok')::boolean, false), nullif(li->>'date_needed','')::date, 'pending');
  END LOOP;
  v_notes := trim(coalesce(p_notes, ''));
  IF char_length(v_notes) BETWEEN 1 AND 1000 THEN
    INSERT INTO request_comments
      (request_id, parent_id, line_item_id, source, author_id, author_name, author_email, author_role, body, mentioned_user_ids)
    VALUES (v_id, NULL, NULL, 'request_notes', auth.uid(), v_name, v_email, 'requester', v_notes, '{}'::uuid[]);
  END IF;
  RETURN v_id;
END;
$fn$;

-- submit_request_anon (v6): public/private form submissions — same notes→comment behavior,
-- anonymous author (author_id NULL). Signature unchanged from 024 (v5).
CREATE OR REPLACE FUNCTION app_procurement.submit_request_anon(p_line_items jsonb, p_notes text, p_requester_email text, p_requester_name text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_id uuid;
  li jsonb;
  v_notes text;
BEGIN
  INSERT INTO purchase_requests
    (requester_id, requester_name, requester_email, requester_type, submission_source, status, notes, submitted_at)
  VALUES (null, p_requester_name, p_requester_email, 'anonymous', 'public_form', 'pending', p_notes, now())
  RETURNING id INTO v_id;
  FOR li IN SELECT * FROM jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) LOOP
    INSERT INTO line_items
      (request_id, ship_to_name, location_id, custom_location, department_id, custom_department,
       item_url, item_description, memo, quantity, substitution_ok, date_needed, status)
    VALUES (v_id, li->>'ship_to_name', nullif(li->>'location_id','')::uuid, li->>'custom_location',
            nullif(li->>'department_id','')::uuid, li->>'custom_department', li->>'item_url',
            li->>'item_description', li->>'memo', coalesce((li->>'quantity')::int, 1),
            coalesce((li->>'substitution_ok')::boolean, false), nullif(li->>'date_needed','')::date, 'pending');
  END LOOP;
  v_notes := trim(coalesce(p_notes, ''));
  IF char_length(v_notes) BETWEEN 1 AND 1000 THEN
    INSERT INTO request_comments
      (request_id, parent_id, line_item_id, source, author_id, author_name, author_email, author_role, body, mentioned_user_ids)
    VALUES (v_id, NULL, NULL, 'request_notes', NULL, coalesce(nullif(p_requester_name,''), p_requester_email), p_requester_email, 'requester', v_notes, '{}'::uuid[]);
  END IF;
  PERFORM internal.proc_recompute_request_status(v_id);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION app_procurement.submit_request_anon(jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.submit_request_anon(jsonb, text, text, text) TO anon, authenticated, service_role;
```

**Apply + verify:**

```
supabase psql -f migrations/035_request_comments.sql
```

```sql
-- sanity: v5 is callable (will fail on permission for anon — expected 'Not permitted' proof of existence)
SELECT proname FROM pg_proc WHERE pronamespace = 'app_procurement'::regnamespace AND proname = 'submit_request';
-- Expected: submit_request
```

**Commit:**
```
git add migrations/035_request_comments.sql
git commit -m "feat(db): submit_request v5 + submit_request_anon v6 post notes as first thread comment; v0.26.0"
```

---

### Task 4: Client `db.ts` — thread reads/writes, mention candidates, realtime subscribe

**Files:**
- `src/data/db.ts:6` (TABLES), `:7` (RPCS), `:10` (LineItemRow), new interfaces after `:46`, new functions inside `useProcurementApi()`, return object `:269`

**Interfaces (produced):**
- `RequestCommentRow { id, request_id, parent_id, line_item_id, source, author_id, author_name, author_email, author_role, body, mentioned_user_ids, created_at }`
- `MentionCandidate { user_id, display_name, email }`
- `postRequestComment(f: { request_id: string; parent_id?: string | null; line_item_id?: string | null; source: 'request' | 'approvals' | 'purchasing' | 'request_notes'; body: string; mentions?: string[] }): Promise<RequestCommentRow>`
- `listRequestComments(requestId: string): Promise<RequestCommentRow[]>`
- `listRequestCommentsMany(requestIds: string[]): Promise<RequestCommentRow[]>`
- `listMentionCandidates(requestId: string): Promise<MentionCandidate[]>`
- `subscribeRequestComments(requestId: string, onInsert: (row: RequestCommentRow) => void, onUnhealthy: () => void): () => void`
- `fireCommentNotification(commentId: string): Promise<void>` (best-effort, never throws)
- `LineItemRow` gains `approved_by: string | null`, `approval_date: string | null`, `date_purchased: string | null`, `updated_at: string` (columns already returned by `select('*')`; type only).

**Edits:**

1. `src/data/db.ts:6` — add the table:
```ts
const TABLES = { requests: 'purchase_requests', lineItems: 'line_items', locations: 'locations', departments: 'departments', config: '_config', purchaseOrders: 'purchase_orders', favoriteItems: 'favorite_items', comments: 'request_comments' } as const
```

2. `src/data/db.ts:7` — add the RPCs:
```ts
const RPCS = { submit: 'submit_request', submitAnon: 'submit_request_anon', decide: 'decide_line_item', order: 'order_line_item', receive: 'receive_line_item', initiateReturn: 'initiate_return', processReturn: 'process_return', setComment: 'set_line_item_comment', deleteItem: 'delete_line_item', archiveItem: 'archive_line_item', cancel: 'cancel_line_item', getUserNames: 'get_user_names', getFormattingRules: 'get_formatting_rules', createPO: 'create_purchase_order', closePO: 'close_purchase_order', postComment: 'post_request_comment', mentionCandidates: 'get_mention_candidates' } as const
```

3. `src/data/db.ts:10` — extend `LineItemRow` (append these fields to the existing object literal, after `archived_at: string | null`):
```ts
  approved_by: string | null
  approval_date: string | null
  date_purchased: string | null
  updated_at: string
```

4. After the `FavoriteItem` interface (`src/data/db.ts:46`), add:
```ts
export interface RequestCommentRow {
  id: string
  request_id: string
  parent_id: string | null
  line_item_id: string | null
  source: 'request' | 'approvals' | 'purchasing' | 'request_notes'
  author_id: string | null
  author_name: string
  author_email: string | null
  author_role: 'requester' | 'staff'
  body: string
  mentioned_user_ids: string[]
  created_at: string
}
export interface MentionCandidate { user_id: string; display_name: string | null; email: string | null }
```

5. Inside `useProcurementApi()`, after `fireNotification` (`src/data/db.ts:131`), add:
```ts
  async function postRequestComment(f: { request_id: string; parent_id?: string | null; line_item_id?: string | null; source: 'request' | 'approvals' | 'purchasing' | 'request_notes'; body: string; mentions?: string[] }): Promise<RequestCommentRow> {
    const row = ok(await db().rpc(RPCS.postComment, {
      p_request_id: f.request_id,
      p_parent_id: f.parent_id ?? null,
      p_line_item_id: f.line_item_id ?? null,
      p_source: f.source,
      p_body: f.body,
      p_mentions: f.mentions ?? [],
    })) as RequestCommentRow
    return row
  }

  async function listRequestComments(requestId: string): Promise<RequestCommentRow[]> {
    return (ok(await db().from(TABLES.comments).select('*').eq('request_id', requestId).order('created_at', { ascending: true })) ?? []) as RequestCommentRow[]
  }

  async function listRequestCommentsMany(requestIds: string[]): Promise<RequestCommentRow[]> {
    if (!requestIds.length) return []
    return (ok(await db().from(TABLES.comments).select('*').in('request_id', requestIds).order('created_at', { ascending: true })) ?? []) as RequestCommentRow[]
  }

  async function listMentionCandidates(requestId: string): Promise<MentionCandidate[]> {
    return (ok(await db().rpc(RPCS.mentionCandidates, { p_request_id: requestId })) ?? []) as MentionCandidate[]
  }

  // Live INSERT updates for an open request (C2 realtime). Supabase realtime delivers
  // INSERT payloads for tables in the supabase_realtime publication. If the channel
  // errors (entitlement/plan differences), onUnhealthy is called so the caller can
  // fall back to 30 s polling (spec C2 line 200 / Risk 1).
  function subscribeRequestComments(requestId: string, onInsert: (row: RequestCommentRow) => void, onUnhealthy: () => void): () => void {
    const channel = supabase
      .channel(`request_comments:${requestId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: SCHEMA, table: TABLES.comments, filter: `request_id=eq.${requestId}` },
        (payload) => { onInsert(payload.new as RequestCommentRow) },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CHANNEL_UNAVAILABLE') onUnhealthy()
      })
    return () => { supabase.removeChannel(channel) }
  }

  // Fire the thread email/bell via the app's edge function. Best-effort (same contract
  // as fireNotification): never throws into the caller.
  async function fireCommentNotification(commentId: string): Promise<void> {
    try {
      await supabase.functions.invoke('procurement-capture-and-notify', {
        body: { event: 'comment_added', comment_id: commentId },
      })
    } catch (e) {
      console.error('fireCommentNotification failed:', e)
    }
  }
```

6. `src/data/db.ts:269` — add to the returned object (append before the closing `}`):
```
postRequestComment, listRequestComments, listRequestCommentsMany, listMentionCandidates, subscribeRequestComments, fireCommentNotification
```

**Verify:** `npm run build` — expected: tsc passes (no type errors from the new interfaces).

**Commit:**
```
git add src/data/db.ts
git commit -m "feat(api): client thread reads/writes, mention candidates, realtime subscribe; v0.26.0"
```

---

### Task 5: Edge function — `comment_added` + `overdue_reminder` events, branded emails

**Files:**
- `supabase/functions/procurement-capture-and-notify/emails.ts` (MODIFY — append builders)
- `supabase/functions/procurement-capture-and-notify/index.ts` (MODIFY — body type, two new event branches)

**Interfaces (produced):**
- `emails.ts`: `buildCommentEmail(o: { authorName: string; authorRole: 'requester' | 'staff'; requestNumber: string | null; itemName: string | null; body: string; linkUrl: string; clientName: string; brandColor?: string }): string`
- `emails.ts`: `buildOverdueReminderEmail(o: { requestNumber: string | null; requesterName: string; days: number; itemCount: number; linkUrl: string; clientName: string; brandColor?: string }): string`
- Function events: `{ event: 'comment_added', comment_id: string }` → `{ event, bell_rows, email_sent, email_recipients }`; `{ event: 'overdue_reminder' }` → `{ event, requests, email_per_request, bell_rows }`

**Email rules implemented (spec C2 table):**

| Event | Email to |
|---|---|
| Staff starts a thread (any surface) | Requester (`request.requester_email`) |
| Requester starts a thread | Nobody |
| Any reply (`parent_id` set) | Only @mentioned users (via `mentioned_user_ids` → `user_profiles.email`) |
| Any comment | In-app bell to the counterpart: staff comment → requester (if `requester_id` portal user); requester comment → newest prior **staff** comment in the same thread; none → no bell |

**Code — `emails.ts` (append at end of file; reuse existing `shell`, `vmlButton`, `tableStyles`):**

```ts
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface CommentEmailParams {
  authorName: string
  authorRole: 'requester' | 'staff'
  requestNumber: string | null
  itemName: string | null
  body: string
  linkUrl: string
  clientName: string
  brandColor?: string
}
export function buildCommentEmail(o: CommentEmailParams): string {
  const { td } = tableStyles(o.brandColor)
  const c = color(o.brandColor)
  const who = o.authorRole === 'staff' ? 'the procurement team' : o.authorName
  const num = o.requestNumber ?? ''
  const itemLine = o.itemName ? `<p style="margin:0 0 12px 0;font-size:13px;color:#555">Item: ${esc(o.itemName)}</p>` : ''
  const rows = `<tr><td style="${td}"><strong>${esc(who)}</strong> ${o.authorRole === 'staff' ? 'commented' : 'replied'}</td><td style="${td}">${num ? `Request ${esc(num)}` : ''}</td></tr>`
  const body = `<p style="margin:0 0 16px 0">${esc(who)} added a comment on your procurement request${num ? ` <strong>${esc(num)}</strong>` : ''}:</p>${itemLine}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0">${rows}</table><blockquote style="margin:0 0 20px 0;padding:12px 16px;border-left:3px solid ${c};background:#f4f6f8;color:#36414d;font-size:14px;line-height:1.5">${esc(o.body)}</blockquote>${o.linkUrl ? vmlButton(o.linkUrl, 'View in Portal', '220px', o.brandColor) : ''}<p style="margin:14px 0 0 0;font-size:12px;color:#555">This is an automated notification from Procurement.</p>`
  return shell('New comment on your procurement request', 'Comment thread update', body, o.clientName, o.brandColor)
}

export interface OverdueReminderParams {
  requestNumber: string | null
  requesterName: string
  days: number
  itemCount: number
  linkUrl: string
  clientName: string
  brandColor?: string
}
export function buildOverdueReminderEmail(o: OverdueReminderParams): string {
  const { td } = tableStyles(o.brandColor)
  const num = o.requestNumber ?? '—'
  const rows = `<tr><td style="${td}"><strong>Request ${esc(num)}</strong></td><td style="${td}">${esc(o.requesterName)}</td><td style="${td};text-align:center">${o.days} days</td><td style="${td};text-align:center">${o.itemCount}</td></tr>`
  const body = `<p style="margin:0 0 16px 0">The following procurement request has been pending for more than 14 days and still needs approval action:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${td}">Request</th><th style="${td}">Requester</th><th style="${td};text-align:center">Days Pending</th><th style="${td};text-align:center">Items</th></tr>${rows}</table>${o.linkUrl ? vmlButton(o.linkUrl, 'Review Request', '220px', o.brandColor) : ''}<p style="margin:14px 0 0 0;font-size:12px;color:#555">This reminder repeats every 14 days while the request stays pending.</p>`
  return shell('Request pending 14+ days', 'Overdue procurement reminder', body, o.clientName, o.brandColor)
}
```

**Code — `index.ts` edit 1** — line 59, extend the body type to include `comment_id`:

```ts
  let body: { request_id?: string; only_line_item_id?: string; event?: string; line_item_ids?: string[]; notification_key?: string; details?: string; comment_id?: string }
```

**Code — `index.ts` edit 2** — extend the import on line 3:

```ts
import { buildApprovedEmail, buildSummaryEmail, buildRequesterConfirmation, buildItemOrderedEmail, buildReturnNotificationEmail, buildItemCancelledEmail, buildNotificationEmail, buildCommentEmail, buildOverdueReminderEmail } from './emails.ts'
```

**Code — `index.ts` edit 3** — insert these two branches immediately after the `item_cancelled` branch (after the closing `}` on line 201, before `// ── Generic shell notification` on line 203):

```ts
  // ── Comment thread notification (Wave C) ──────────────────────────────────
  if (event === 'comment_added') {
    const commentId = body.comment_id
    if (!commentId) return json({ event: 'comment_added', skipped: true, reason: 'no comment_id' })
    const { data: c } = await db.schema('app_procurement').from('request_comments').select('id, request_id, parent_id, line_item_id, source, author_id, author_name, author_email, author_role, body, mentioned_user_ids, created_at').eq('id', commentId).maybeSingle()
    if (!c) return json({ event: 'comment_added', skipped: true, reason: 'comment not found' }, 404)
    const comment = c as { id: string; request_id: string; parent_id: string | null; line_item_id: string | null; source: string; author_id: string | null; author_name: string; author_email: string | null; author_role: 'requester' | 'staff'; body: string; mentioned_user_ids: string[]; created_at: string }
    const { data: req } = await db.schema('app_procurement').from('purchase_requests').select('id, request_number, requester_id, requester_name, requester_email').eq('id', comment.request_id).maybeSingle()
    const requestRow = req as { id: string; request_number: number | null; requester_id: string | null; requester_name: string | null; requester_email: string | null } | null
    if (!requestRow) return json({ event: 'comment_added', skipped: true, reason: 'request not found' }, 404)
    const reqUrl = requestsUrl ? `${requestsUrl}?request=${comment.request_id}` : ''

    // Thread = this comment's root + its direct replies (threads are 1 level deep).
    let rootId = comment.id
    if (comment.parent_id) {
      const { data: parent } = await db.schema('app_procurement').from('request_comments').select('id, parent_id').eq('id', comment.parent_id).maybeSingle()
      const p = parent as { id: string; parent_id: string | null } | null
      rootId = p ? (p.parent_id ?? p.id) : comment.parent_id
    }
    const { data: threadRows } = await db.schema('app_procurement').from('request_comments').select('id, author_id, author_role, created_at').or(`id.eq.${rootId},parent_id.eq.${rootId}`)
    const thread = (threadRows ?? []) as Array<{ id: string; author_id: string | null; author_role: 'requester' | 'staff'; created_at: string }>

    // Bell target (counterpart): staff comment → requester (if portal user);
    // requester comment → newest prior staff commenter in the thread.
    let bellTarget: string | null = null
    if (comment.author_role === 'staff') {
      bellTarget = requestRow.requester_id
    } else {
      const prior = thread
        .filter((t) => t.id !== comment.id && t.author_role === 'staff' && t.author_id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      bellTarget = prior.length ? (prior[prior.length - 1]!.author_id as string) : null
    }

    // Email: staff-started thread → requester; requester-started → nobody; reply → mentioned users only.
    let emailRecipients: string[] = []
    if (comment.parent_id === null) {
      if (comment.author_role === 'staff' && requestRow.requester_email) emailRecipients = [requestRow.requester_email]
    } else {
      const mids = (comment.mentioned_user_ids ?? []).filter(Boolean)
      if (mids.length) {
        const { data: mentioned } = await db.from('user_profiles').select('id, email').in('id', mids)
        emailRecipients = ((mentioned ?? []) as Array<{ email: string | null }>).map((m) => m.email).filter((e): e is string => !!e)
      }
    }

    // Bell rows: counterpart + (for replies) mentioned portal users. Dedupe by user_id.
    const bellUsers = new Set<string>()
    if (bellTarget) bellUsers.add(bellTarget)
    if (comment.parent_id !== null) for (const m of (comment.mentioned_user_ids ?? []).filter(Boolean)) bellUsers.add(m)
    const snippet = comment.body.length > 140 ? comment.body.slice(0, 140) + '…' : comment.body
    const title = `${clientName ? `${clientName} Procurement` : 'Procurement'}: ${comment.author_name} commented on your request`
    const bellRows = [...bellUsers].map((uid) => ({ user_id: uid, event_type: 'procurement:comment_added', title, body: snippet, link: reqUrl, app_slug: 'procurement' }))
    if (bellRows.length) {
      const { error: bellErr } = await db.from('notifications').insert(bellRows)
      if (bellErr) console.error('comment bell insert failed:', bellErr)
    }

    let emailSent = false
    if (emailRecipients.length && sender && HVE_PASSWORD) {
      let itemName: string | null = null
      if (comment.line_item_id) {
        const { data: li } = await db.schema('app_procurement').from('line_items').select('item_description').eq('id', comment.line_item_id).maybeSingle()
        itemName = (li as { item_description: string | null } | null)?.item_description ?? null
      }
      const html = buildCommentEmail({
        authorName: comment.author_name,
        authorRole: comment.author_role,
        requestNumber: requestRow.request_number != null ? `#${requestRow.request_number}` : null,
        itemName,
        body: comment.body,
        linkUrl: reqUrl,
        clientName,
        brandColor,
      })
      try {
        await sendSmtp(
          { host: HVE_HOST, port: HVE_PORT, fromAddress: sender, useTls: true, auth: { type: 'login', username: sender, password: HVE_PASSWORD } },
          { recipients: emailRecipients, subject: title, htmlBody: html, fromDisplayName: clientName ? `${clientName} Procurement` : 'Procurement', highPriority: false },
        )
        emailSent = true
      } catch (e) { console.error('comment email failed:', e instanceof Error ? e.message : e) }
    }
    return json({ event: 'comment_added', bell_rows: bellRows.length, email_sent: emailSent, email_recipients: emailRecipients.length })
  }

  // ── 14-day overdue reminder (Wave C) — fired by pg_cron daily at 08:00 ─────
  if (event === 'overdue_reminder') {
    const { data: approvers } = await db.schema('app_procurement').rpc('get_permission_holders', { p_permission: APPROVE_PERMISSION })
    const approverIds = new Set(((approvers ?? []) as Array<{ user_id: string }>).map((h) => h.user_id))
    let recipients = await resolveNotificationRecipients(db, 'procurement:request_overdue_reminder')
    recipients = recipients.filter((r) => r.user_id !== null && approverIds.has(r.user_id))
    if (recipients.length === 0) return json({ event: 'overdue_reminder', skipped: true, reason: 'no recipients' })

    // status IN ('pending','on_hold','partially_approved') AND submitted_at <= now()-14d;
    // the 14-day re-fire window on last_overdue_reminder_at is filtered in JS (nullable column).
    const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
    const { data: rows } = await db.schema('app_procurement').from('purchase_requests')
      .select('id, request_number, requester_name, requester_email, status, submitted_at, last_overdue_reminder_at, line_items(id)')
      .in('status', ['pending', 'on_hold', 'partially_approved'])
      .lte('submitted_at', cutoff)
    const nowIso = new Date().toISOString()
    const due = ((rows ?? []) as Array<{ id: string; request_number: number | null; requester_name: string | null; submitted_at: string; last_overdue_reminder_at: string | null; line_items: { id: string }[] }>)
      .filter((r) => !r.last_overdue_reminder_at || r.last_overdue_reminder_at <= cutoff)

    let emails = 0
    let bells = 0
    for (const r of due) {
      const days = Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / 86400000)
      const reqUrl = requestsUrl ? `${requestsUrl}?request=${r.id}` : ''
      const title = `${clientName ? `${clientName} Procurement` : 'Procurement'}: request pending ${days} days`
      const bellRows = recipients.filter((x) => x.user_id).map((x) => ({
        user_id: x.user_id as string,
        event_type: 'procurement:request_overdue_reminder',
        title,
        body: `Request ${r.request_number != null ? '#' + r.request_number : ''} from ${r.requester_name ?? 'a requester'} is pending ${days} days.`,
        link: reqUrl,
        app_slug: 'procurement',
      }))
      if (bellRows.length) {
        const { error: bellErr } = await db.from('notifications').insert(bellRows)
        if (bellErr) console.error('overdue bell insert failed:', bellErr)
        else bells += bellRows.length
      }
      if (sender && HVE_PASSWORD) {
        const html = buildOverdueReminderEmail({
          requestNumber: r.request_number != null ? `#${r.request_number}` : null,
          requesterName: r.requester_name ?? 'A requester',
          days,
          itemCount: r.line_items?.length ?? 0,
          linkUrl: reqUrl,
          clientName,
          brandColor,
        })
        try {
          await sendSmtp(
            { host: HVE_HOST, port: HVE_PORT, fromAddress: sender, useTls: true, auth: { type: 'login', username: sender, password: HVE_PASSWORD } },
            { recipients: recipients.map((x) => x.email), subject: title, htmlBody: html, fromDisplayName: clientName ? `${clientName} Procurement` : 'Procurement', highPriority: false },
          )
          emails++
        } catch (e) { console.error('overdue email failed:', e instanceof Error ? e.message : e) }
      }
    }
    if (due.length) {
      const { error: stampErr } = await db.schema('app_procurement').from('purchase_requests')
        .update({ last_overdue_reminder_at: nowIso }).in('id', due.map((r) => r.id))
      if (stampErr) console.error('overdue stamp update failed:', stampErr)
    }
    return json({ event: 'overdue_reminder', requests: due.length, email_per_request: emails, bell_rows: bells })
  }
```

**Verify (manual, in session after redeploy or via local test):**
- Invoke with `{"event":"overdue_reminder"}` via the QA function URL (or curl with no auth header) — expected JSON `{ event: 'overdue_reminder', requests: 0, email_per_request: 0, bell_rows: 0 }` while no request is 14+ days old.
- Invoke with `{"event":"comment_added","comment_id":"<existing id>"}` — expected JSON with `bell_rows`/`email_sent` counts and no 5xx.

**Commit:**
```
git add supabase/functions/procurement-capture-and-notify/index.ts supabase/functions/procurement-capture-and-notify/emails.ts
git commit -m "feat(notify): comment_added + overdue_reminder events with branded emails; v0.26.0"
```

---

### Task 6: Migration 036 — `last_overdue_reminder_at` dedupe column

**Files:**
- `migrations/036_last_overdue_reminder_at.sql` (CREATE)

**Code** (full file):

```sql
-- 036: Wave C (C3) — dedupe column for the 14-day overdue reminder.
-- A pending request re-fires the reminder only when this stamp is older than 14 days.
ALTER TABLE app_procurement.purchase_requests ADD COLUMN IF NOT EXISTS last_overdue_reminder_at timestamptz;
```

**Apply + verify:**

```
supabase psql -f migrations/036_last_overdue_reminder_at.sql
```

```sql
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'app_procurement' AND table_name = 'purchase_requests' AND column_name = 'last_overdue_reminder_at';
-- Expected: 1
```

**Commit:**
```
git add migrations/036_last_overdue_reminder_at.sql
git commit -m "feat(db): last_overdue_reminder_at dedupe column for 14-day reminder; v0.26.0"
```

---

### Task 7: Migration 037 — pg_cron daily 08:00 keyless reminder job + manifest `config` seed

**Files:**
- `migrations/037_overdue_cron.sql` (CREATE)
- `app.manifest.json` (MODIFY — add `database.config` so publish-app seeds `_config.supabase_url` per environment; see code)

**Interfaces:**
- `cron.job` row `procurement-overdue-reminders`, schedule `0 8 * * *` (DB timezone).
- `app_procurement._config` row `supabase_url = https://<ref>.supabase.co` (seeded by publish-app from manifest `config[]` with `source: "project_url"` — the same migration file then works on both QA and prod).

**Code — `migrations/037_overdue_cron.sql`** (full file):

```sql
-- 037: Wave C (C3) — daily 08:00 (DB timezone) overdue-reminder schedule.
-- pg_cron -> net.http_post -> procurement-capture-and-notify, body {"event":"overdue_reminder"}.
-- KEYLESS by decision D1 (CLAUDE.md: never store a service-role JWT in a client-visible vault;
-- msr-overtime-dashboard-app v14 dropped the vault-JWT cron pattern; this function is
-- verify_jwt:false and holds its own service-role key in the edge runtime env).
-- The URL is built from _config.supabase_url (seeded per-environment by publish-app via
-- manifest config[] source=project_url), so this same file works on QA and prod.
-- Idempotent: unschedules any existing job of the same name first.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'procurement-overdue-reminders') THEN
    PERFORM cron.unschedule('procurement-overdue-reminders');
  END IF;
END $$;

INSERT INTO cron.job (schedule, command) VALUES (
  '0 8 * * *',
  $$SELECT net.http_post(
        url := (SELECT value FROM app_procurement._config WHERE key = 'supabase_url') || '/functions/v1/procurement-capture-and-notify',
        body := '{"event":"overdue_reminder"}'::jsonb,
        headers := '{"Content-Type":"application/json"}'::jsonb
      );$$
);
```

**Code — `app.manifest.json`**: add a `config` array inside `database` (next to `"schema": "app_procurement"`):

```json
    "config": [
      { "key": "supabase_url", "source": "project_url", "description": "Project base URL; read by the pg_cron overdue-reminder job (migration 037) to call the edge function." }
    ],
```

**Apply + verify** (on QA; the manual `_config` seed stands in for the publish-app seed until the v0.26.0 `.eitapp` is uploaded):

```
supabase psql -f migrations/037_overdue_cron.sql
```

```sql
-- seed the config row for QA now (publish-app will upsert the same value at upload time):
INSERT INTO app_procurement._config (key, value)
VALUES ('supabase_url', 'https://jkbqaxpfvqbeepwhunhl.supabase.co')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

```sql
SELECT jobname, schedule FROM cron.job WHERE jobname = 'procurement-overdue-reminders';
-- Expected: one row, schedule = 0 8 * * *
SELECT value FROM app_procurement._config WHERE key = 'supabase_url';
-- Expected: https://jkbqaxpfvqbeepwhunhl.supabase.co
```

**Commit:**
```
git add migrations/037_overdue_cron.sql app.manifest.json
git commit -m "feat(db): daily 08:00 keyless pg_cron overdue-reminder job + _config.supabase_url seed; v0.26.0"
```

---

### Task 8: Pure libs + components — `timeline.ts`, `mentions.ts`, `RequestActivity`, `RequestThread` (+ vitest)

**Files:**
- `src/lib/timeline.ts` (CREATE)
- `src/lib/mentions.ts` (CREATE)
- `src/lib/timeline.test.ts` (CREATE)
- `src/lib/mentions.test.ts` (CREATE)
- `src/components/RequestActivity.tsx` (CREATE)
- `src/components/RequestThread.tsx` (CREATE)

**Interfaces (produced):**
- `buildTimeline(input: { request: Pick<RequestRow,'request_number'|'submitted_at'|'status'>; items: LineItemRow[]; comments: RequestCommentRow[]; itemName: (li: LineItemRow) => string; nameOf: (id: string) => string }): TimelineEvent[]`
- `TimelineEvent { id: string; at: string | null; kind: 'submitted'|'comment'|'decision'|'ordered'|'received'|'returned'|'return_processed'|'cancelled'|'archived'; label: string; detail?: string; badge?: string }`
- `parseMentions(body: string, candidates: MentionCandidate[]): string[]` — returns display names to send as `p_mentions`
- `RequestActivity({ events }: { events: TimelineEvent[] })`
- `RequestThread({ request, items, comments, onPosted }: { request: RequestRow; items: LineItemRow[]; comments: RequestCommentRow[]; onPosted: () => void })`

**Code — `src/lib/timeline.ts`** (full file):

```ts
import type { LineItemRow, RequestCommentRow, RequestRow } from '../data/db'

export type TimelineKind = 'submitted' | 'comment' | 'decision' | 'ordered' | 'received' | 'returned' | 'return_processed' | 'cancelled' | 'archived'

export interface TimelineEvent {
  id: string
  at: string | null
  kind: TimelineKind
  label: string
  detail?: string
  badge?: string
}

const DECISION_LABEL: Record<string, string> = { approved: 'approved', declined: 'declined', on_hold: 'placed on hold' }

interface TimelineInput {
  request: Pick<RequestRow, 'request_number' | 'submitted_at' | 'status'>
  items: LineItemRow[]
  comments: RequestCommentRow[]
  itemName: (li: LineItemRow) => string
  nameOf: (id: string) => string
}

// Derived timeline (decision 14: no event log table). Newest first.
// Caveats (spec Risk 3): "received" and "cancelled" carry no dedicated timestamp column,
// so their time comes from line_items.updated_at (the RPC that flips the status stamps it).
export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const { request, items, comments, itemName, nameOf } = input
  const events: TimelineEvent[] = [
    { id: 'submitted', at: request.submitted_at, kind: 'submitted', label: `Request submitted${request.request_number != null ? ` #${request.request_number}` : ''}` },
  ]

  for (const li of items) {
    const name = itemName(li)
    if (DECISION_LABEL[li.status] && li.approval_date && li.approved_by) {
      events.push({ id: `li-${li.id}-decision`, at: li.approval_date, kind: 'decision', badge: li.status, label: `${nameOf(li.approved_by)} ${DECISION_LABEL[li.status]} ${name}` })
    }
    if (['ordered', 'received', 'returned', 'replacement_ordered'].includes(li.status) && li.date_purchased) {
      events.push({ id: `li-${li.id}-ordered`, at: `${li.date_purchased}T12:00:00Z`, kind: 'ordered', label: `Ordered ${name}${li.po_id ? ' (PO created)' : ''}` })
    }
    if (li.status === 'received') {
      events.push({ id: `li-${li.id}-received`, at: li.updated_at, kind: 'received', label: `Marked received — ${name}` })
    }
    if (li.return_date) {
      events.push({ id: `li-${li.id}-returned`, at: li.return_date, kind: 'returned', label: `Return initiated — ${name}` })
    }
    if (li.return_processed_at) {
      events.push({ id: `li-${li.id}-return_processed`, at: li.return_processed_at, kind: 'return_processed', label: `Return processed — ${name}` })
    }
    if (li.status === 'cancelled') {
      events.push({ id: `li-${li.id}-cancelled`, at: li.updated_at, kind: 'cancelled', label: `Item cancelled — ${name}` })
    }
    if (li.archived_at) {
      events.push({ id: `li-${li.id}-archived`, at: li.archived_at, kind: 'archived', label: `Item archived — ${name}` })
    }
  }

  for (const c of comments) {
    events.push({
      id: `comment-${c.id}`,
      at: c.created_at,
      kind: 'comment',
      badge: c.source,
      label: `${c.author_name} commented${c.line_item_id ? ' on an item' : ''}`,
      detail: c.body,
    })
  }

  return events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
}
```

**Code — `src/lib/mentions.ts`** (full file):

```ts
import type { MentionCandidate } from '../data/db'

/**
 * Resolve @mention tokens in a comment body against the candidate list.
 * A token matches a candidate by display name ("@Jane Doe") or email local
 * part ("@jane.doe"); matched users are returned as display names (what
 * post_request_comment resolves server-side). Unmatched @text stays plain text.
 */
export function parseMentions(body: string, candidates: MentionCandidate[]): string[] {
  const lower = body.toLowerCase()
  const out: string[] = []
  for (const c of candidates) {
    const dn = c.display_name?.trim()
    const local = c.email ? c.email.split('@')[0].toLowerCase() : ''
    const hit = (dn && dn.length >= 2 && lower.includes(`@${dn.toLowerCase()}`)) || (local && lower.includes(`@${local}`))
    if (hit && dn && !out.includes(dn)) out.push(dn)
  }
  return out
}
```

**Code — `src/lib/timeline.test.ts`** (full file):

```ts
import { describe, expect, it } from 'vitest'
import { buildTimeline } from './timeline'
import type { LineItemRow, RequestCommentRow, RequestRow } from '../data/db'

function req(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'r1', requester_id: 'u1', requester_name: 'Jane', requester_email: 'jane@x.com',
    requester_type: 'portal_user', status: 'pending', notes: null,
    submitted_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T09:00:00Z', request_number: 7, ...over,
  }
}
function li(over: Partial<LineItemRow> = {}): LineItemRow {
  return {
    id: 'l1', request_id: 'r1', item_description: 'Monitor', item_url: null, memo: null,
    quantity: 1, substitution_ok: false, status: 'pending', location_id: null, custom_location: null,
    department_id: null, custom_department: null, date_needed: null, eta: null, admin_comment: null,
    commented_by: null, commented_at: null, product_image_path: null, return_reason: null,
    return_quantity: null, wants_replacement: null, return_notes: null, return_date: null,
    created_at: '2026-08-01T09:00:00Z', line_no: 1, return_processed_at: null, po_id: null,
    archived_at: null, approved_by: null, approval_date: null, date_purchased: null,
    updated_at: '2026-08-01T09:00:00Z', ...over,
  }
}
function cm(over: Partial<RequestCommentRow> = {}): RequestCommentRow {
  return {
    id: 'c1', request_id: 'r1', parent_id: null, line_item_id: null, source: 'request',
    author_id: 'u2', author_name: 'Staff', author_email: 's@x.com', author_role: 'staff',
    body: 'ok', mentioned_user_ids: [], created_at: '2026-08-02T10:00:00Z', ...over,
  }
}
const nameOf = (id: string) => (id === 'u9' ? 'J. Bugahon' : 'Unknown')
const itemName = (i: LineItemRow) => i.item_description ?? 'Item'

describe('buildTimeline', () => {
  it('always includes the submission event as the oldest', () => {
    const events = buildTimeline({ request: req(), items: [], comments: [], itemName, nameOf })
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('submitted')
    expect(events[0].label).toContain('#7')
  })

  it('orders newest first and interleaves comments with decisions', () => {
    const events = buildTimeline({
      request: req(),
      items: [li({ id: 'l1', status: 'approved', approval_date: '2026-08-03T12:00:00Z', approved_by: 'u9' })],
      comments: [cm({ id: 'c1', created_at: '2026-08-02T10:00:00Z' }), cm({ id: 'c2', created_at: '2026-08-04T08:00:00Z' })],
      itemName,
      nameOf,
    })
    expect(events.map((e) => e.kind)).toEqual(['comment', 'decision', 'comment', 'submitted'])
    expect(events[1].label).toBe('J. Bugahon approved Monitor')
  })

  it('derives ordered/received/cancelled from item status fields', () => {
    const events = buildTimeline({
      request: req({ status: 'approved' }),
      items: [
        li({ id: 'l1', status: 'received', po_id: 'po1', date_purchased: '2026-08-10', updated_at: '2026-08-20T09:00:00Z' }),
        li({ id: 'l2', item_description: 'Dock', status: 'cancelled', updated_at: '2026-08-12T09:00:00Z' }),
      ],
      comments: [],
      itemName,
      nameOf,
    })
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('ordered')
    expect(kinds).toContain('received')
    expect(kinds).toContain('cancelled')
    expect(kinds[kinds.length - 1]).toBe('submitted')
  })
})
```

**Code — `src/lib/mentions.test.ts`** (full file):

```ts
import { describe, expect, it } from 'vitest'
import { parseMentions } from './mentions'
import type { MentionCandidate } from '../data/db'

const cands: MentionCandidate[] = [
  { user_id: 'u1', display_name: 'Jane Doe', email: 'jane.doe@x.com' },
  { user_id: 'u2', display_name: 'John Smith', email: 'john@x.com' },
]

describe('parseMentions', () => {
  it('resolves @display-name tokens case-insensitively', () => {
    expect(parseMentions('ping @Jane Doe about it', cands)).toEqual(['Jane Doe'])
  })
  it('resolves @email-local-part tokens to the display name', () => {
    expect(parseMentions('ping @john', cands)).toEqual(['John Smith'])
  })
  it('returns multiple unique matches in candidate order', () => {
    expect(parseMentions('@John Smith and @jane.doe@x.com', cands)).toEqual(['Jane Doe', 'John Smith'])
  })
  it('leaves unmatched @text out', () => {
    expect(parseMentions('@nobody here', cands)).toEqual([])
  })
  it('does not double-count a user matched by name and email', () => {
    expect(parseMentions('@Jane Doe and @jane.doe@x.com', cands)).toEqual(['Jane Doe'])
  })
})
```

**Verify:** `npm test` — expected: the new suites pass (8 tests), existing suites unaffected.

**Commit:**
```
git add src/lib/timeline.ts src/lib/mentions.ts src/lib/timeline.test.ts src/lib/mentions.test.ts
git commit -m "feat(ui): pure timeline + mention parsing with unit tests; v0.26.0"
```

---

### Task 8b: Components — `RequestActivity.tsx` + `RequestThread.tsx`

**Code — `src/components/RequestActivity.tsx`** (full file):

```tsx
import type { TimelineEvent } from '../lib/timeline'
import { formatDate } from '../lib/constants'

const TIME_FMT: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }

interface RequestActivityProps {
  events: TimelineEvent[]
}

export function RequestActivity({ events }: RequestActivityProps) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>
  return (
    <ol className="grid gap-2">
      {events.map((e) => (
        <li key={e.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
          <div className="grid gap-0.5">
            <p className="text-sm text-foreground">
              {e.label}
              {e.badge && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{e.badge.replace(/_/g, ' ')}</span>}
            </p>
            {e.detail && <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">{e.detail}</p>}
          </div>
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{e.at ? formatDate(e.at, TIME_FMT) : '—'}</span>
        </li>
      ))}
    </ol>
  )
}

export default RequestActivity
```

**Code — `src/components/RequestThread.tsx`** (full file):

```tsx
import { useMemo, useState } from 'react'
import { useShellContext, useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, type LineItemRow, type MentionCandidate, type RequestCommentRow, type RequestRow } from '../data/db'
import { useAppPermissions } from '../lib/useAppPermissions'
import { PERMS, formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'
import { parseMentions } from '../lib/mentions'

const TIME_FMT: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }

const SOURCE_LABEL: Record<RequestCommentRow['source'], string> = {
  request: 'Request',
  approvals: 'Approvals',
  purchasing: 'Purchasing',
  request_notes: 'Request notes',
}

function RoleBadge({ role }: { role: RequestCommentRow['author_role'] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${role === 'staff' ? 'bg-info/15 text-info' : 'bg-muted text-muted-foreground'}`}>
      {role === 'staff' ? 'Staff' : 'Requester'}
    </span>
  )
}

function MentionList({ candidates, onPick }: { candidates: MentionCandidate[]; onPick: (c: MentionCandidate) => void }) {
  if (candidates.length === 0) return <p className="text-[11px] text-muted-foreground">No matching people</p>
  return (
    <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-card shadow-sm">
      {candidates.map((c) => (
        <button key={c.user_id} type="button" onClick={() => onPick(c)} className="w-full px-2 py-1 text-left text-xs text-foreground hover:bg-muted">
          {c.display_name ?? c.email}
          {c.email ? <span className="text-muted-foreground"> ({c.email})</span> : null}
        </button>
      ))}
    </div>
  )
}

function trailingMention(text: string): { start: number; query: string } | null {
  const idx = text.lastIndexOf('@')
  if (idx === -1) return null
  const after = text.slice(idx + 1)
  return /\s/.test(after) ? null : { start: idx, query: after }
}

interface RequestThreadProps {
  request: RequestRow
  items: LineItemRow[]
  comments: RequestCommentRow[]
  onPosted: () => void
}

export function RequestThread({ request, items, comments, onPosted }: RequestThreadProps) {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()
  const { user } = useShellContext()

  const [draft, setDraft] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [collapseOverride, setCollapseOverride] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [pickerFor, setPickerFor] = useState<'new' | string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [candidates, setCandidates] = useState<MentionCandidate[]>([])

  const isStaff = hasAppPermission(PERMS.approve) || hasAppPermission(PERMS.purchase) || hasAppPermission(PERMS.admin)
  const isRequester = !!user && ((request.requester_id !== null && user.id === request.requester_id)
    || (request.requester_id === null && !!user.email && !!request.requester_email
      && user.email.toLowerCase() === request.requester_email.toLowerCase()))
  const canComment = isStaff || isRequester

  const roots = useMemo(
    () => comments.filter((c) => c.parent_id === null).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [comments],
  )
  const repliesByRoot = useMemo(() => {
    const map: Record<string, RequestCommentRow[]> = {}
    for (const c of comments) if (c.parent_id) (map[c.parent_id] ??= []).push(c)
    for (const key of Object.keys(map)) map[key].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return map
  }, [comments])

  // Collapsed by default; the newest thread auto-expands.
  const newestRootId = roots[0]?.id ?? null
  const isCollapsed = (rootId: string) => collapseOverride[rootId] ?? rootId !== newestRootId

  const itemRef = (lineItemId: string | null): string | null => {
    if (!lineItemId) return null
    const li = items.find((i) => i.id === lineItemId)
    return li ? formatItemRef(request.request_number, li.line_no) : null
  }

  async function loadCandidates() {
    try { setCandidates(await api.listMentionCandidates(request.id)) } catch { setCandidates([]) }
  }

  function trackMention(target: 'new' | string, text: string) {
    const tm = trailingMention(text)
    if (tm) {
      setPickerFor(target)
      setPickerQuery(tm.query)
      if (candidates.length === 0) void loadCandidates()
    } else if (pickerFor !== null) {
      setPickerFor(null)
    }
  }

  const visibleCandidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => (c.display_name?.toLowerCase().includes(q) ?? false) || (c.email?.toLowerCase().includes(q) ?? false))
  }, [candidates, pickerQuery])

  function applyMention(target: 'new' | string, c: MentionCandidate) {
    const label = `@${c.display_name ?? c.email?.split('@')[0] ?? ''} `
    if (target === 'new') {
      const tm = trailingMention(draft)
      if (tm) setDraft(draft.slice(0, tm.start) + label)
    } else {
      const text = replyDrafts[target] ?? ''
      const tm = trailingMention(text)
      if (tm) setReplyDrafts((d) => ({ ...d, [target]: text.slice(0, tm.start) + label }))
    }
    setPickerFor(null)
    setPickerQuery('')
  }

  async function post(body: string, parent: RequestCommentRow | null) {
    const trimmed = body.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const row = await api.postRequestComment({
        request_id: request.id,
        parent_id: parent?.id ?? null,
        line_item_id: parent?.line_item_id ?? null,
        source: 'request',
        body: trimmed,
        mentions: parseMentions(trimmed, candidates),
      })
      api.fireCommentNotification(row.id)
      setDraft('')
      if (parent) setReplyDrafts((d) => ({ ...d, [parent.id]: '' }))
      showToast({ message: 'Comment posted', type: 'success' })
      onPosted()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to post comment', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (!canComment && comments.length === 0) return null

  return (
    <div className="grid gap-3">
      {canComment && (
        <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
          <label className="text-xs font-medium text-foreground">New comment</label>
          <textarea
            rows={2}
            maxLength={1000}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); trackMention('new', e.target.value) }}
            placeholder="Add a comment… use @ to mention"
            className="w-full resize-none rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {pickerFor === 'new' && <MentionList candidates={visibleCandidates} onPick={(c) => applyMention('new', c)} />}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => post(draft, null)}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Post
            </button>
          </div>
        </div>
      )}

      {roots.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}

      {roots.map((root) => {
        const replies = repliesByRoot[root.id] ?? []
        const open = !isCollapsed(root.id)
        return (
          <div key={root.id} className="rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => setCollapseOverride((m) => ({ ...m, [root.id]: !open }))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              <span className="text-xs text-muted-foreground">{open ? '▾' : '▸'}</span>
              <span className="text-sm font-medium text-foreground">{root.author_name}</span>
              <RoleBadge role={root.author_role} />
              {root.source !== 'request' && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{SOURCE_LABEL[root.source]}</span>
              )}
              {itemRef(root.line_item_id) && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{itemRef(root.line_item_id)}</span>
              )}
              <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                {formatDate(root.created_at, TIME_FMT)} · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </span>
            </button>
            {open && (
              <div className="grid gap-2 border-t border-border px-3 pb-3 pt-2">
                <p className="text-sm whitespace-pre-wrap break-words text-foreground">{root.body}</p>
                {replies.map((r) => (
                  <div key={r.id} className="ml-4 grid gap-0.5 rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{r.author_name}</span>
                      <RoleBadge role={r.author_role} />
                      <span className="text-[11px] text-muted-foreground">{formatDate(r.created_at, TIME_FMT)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words text-foreground">{r.body}</p>
                  </div>
                ))}
                {canComment && (
                  <div className="ml-4 grid gap-1">
                    <textarea
                      rows={1}
                      maxLength={1000}
                      value={replyDrafts[root.id] ?? ''}
                      onChange={(e) => { setReplyDrafts((d) => ({ ...d, [root.id]: e.target.value })); trackMention(root.id, e.target.value) }}
                      placeholder="Reply…"
                      className="w-full resize-none rounded-md border border-input bg-input px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    {pickerFor === root.id && <MentionList candidates={visibleCandidates} onPick={(c) => applyMention(root.id, c)} />}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={busy || !(replyDrafts[root.id] ?? '').trim()}
                        onClick={() => post(replyDrafts[root.id] ?? '', root)}
                        className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default RequestThread
```

**Verify:** `npm run build` — tsc passes (types line up: `RequestCommentRow`, `MentionCandidate` from db.ts).

**Commit:**
```
git add src/components/RequestActivity.tsx src/components/RequestThread.tsx
git commit -m "feat(ui): RequestActivity timeline + collapsible RequestThread with @mention picker; v0.26.0"
```

---

### Task 9: UI integration — `RequestDetail.tsx` + `ApprovalsPage.tsx`

**Files:**
- `src/requester/RequestDetail.tsx` (MODIFY) — add Activity (C1) + Comments (C2) sections, realtime
- `src/pages/ApprovalsPage.tsx` (MODIFY) — replace the legacy 100-char comment editor with a thread composer + "View full thread" deep link

**Depends on:** Tasks 4 (db functions/types), 8 (buildTimeline), 8b (components).

#### Edits — `src/requester/RequestDetail.tsx`

1. `:1` — add `useMemo`:
```ts
import { useState, useEffect, useCallback, useMemo } from 'react'
```

2. `:3` — extend the db import:
```ts
import { useProcurementApi, RequestRow, LineItemRow, FavoriteItem, type RequestCommentRow } from '../data/db'
```

3. After `:10` (the `formatItemRef` import) — add:
```ts
import { RequestActivity } from '../components/RequestActivity'
import { RequestThread } from '../components/RequestThread'
import { buildTimeline } from '../lib/timeline'
```

4. After the `heartBusyId` state (`:32`) — add:
```ts
  const [comments, setComments] = useState<RequestCommentRow[]>([])
  const [approvedNames, setApprovedNames] = useState<Record<string, string>>({})
```

5. `:96-111` — replace the `load` callback (add comments + approver-name resolution):
```ts
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [req, items, cmts] = await Promise.all([
        api.getRequest(requestId),
        api.listLineItems(requestId),
        api.listRequestComments(requestId),
      ])
      setRequest(req)
      setLineItems(items)
      setComments(cmts)
      const approvers = Array.from(new Set(items.map((i) => i.approved_by).filter((x): x is string => !!x)))
      if (approvers.length) setApprovedNames(await api.resolveUserNames(approvers))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load request')
    } finally {
      setLoading(false)
    }
  }, [requestId])
```

6. After `useEffect(() => { load() }, [load])` (`:113`) — add realtime subscription (with 30 s polling fallback per spec C2 line 200 / Risk 1) and the derived timeline memo:
```ts
  useEffect(() => {
    let poll: number | undefined
    const stop = api.subscribeRequestComments(
      requestId,
      () => { void api.listRequestComments(requestId).then(setComments).catch(() => {}) },
      () => {
        if (poll === undefined) {
          poll = window.setInterval(() => {
            void api.listRequestComments(requestId).then(setComments).catch(() => {})
          }, 30000)
        }
      },
    )
    return () => { stop(); if (poll !== undefined) window.clearInterval(poll) }
  }, [requestId])

  const timeline = useMemo(
    () =>
      request
        ? buildTimeline({
            request,
            items: lineItems,
            comments,
            itemName: (li) => formatItemRef(request.request_number, li.line_no),
            nameOf: (id) => approvedNames[id] ?? 'Unknown',
          })
        : [],
    [request, lineItems, comments, approvedNames],
  )
```
(All hooks stay above the early `if (loading)` / `if (error || !request)` returns.)

7. JSX — insert after the line-items grid closes (the `</div>` at `:260`, before the final `</div>` of the root `grid gap-6`):
```tsx
      {/* Activity history (C1 — derived timeline, no event log) */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold text-foreground">Activity</h3>
        <RequestActivity events={timeline} />
      </div>

      {/* Comment thread (C2) — full thread, @mention picker, realtime */}
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold text-foreground">Comments</h3>
        <RequestThread
          request={request}
          items={lineItems}
          comments={comments}
          onPosted={() => { void api.listRequestComments(requestId).then(setComments).catch(() => {}) }}
        />
      </div>
```

`RequestThread` computes its own `canComment` (staff perms OR the request's own requester via `useShellContext` user id/email) — no extra prop needed.

#### Edits — `src/pages/ApprovalsPage.tsx`

1. `:1` — add `useMemo`:
```ts
import { useState, useEffect, useCallback, useMemo } from 'react'
```

2. `:4` — extend the db import:
```ts
import { useProcurementApi, LineItemWithRequest, type RequestCommentRow } from '../data/db'
```

3. `:20` — replace the `names` state (it only fed the old comment editor's attribution line) with the thread-comments state:
```ts
  const [comments, setComments] = useState<RequestCommentRow[]>([])
```

4. `:30` — inside `load`, replace:
```ts
      setNames(await api.resolveUserNames(data.map((i) => i.commented_by).filter((x): x is string => !!x)))
```
with:
```ts
      setComments(await api.listRequestCommentsMany(Array.from(new Set(data.map((i) => i.request.id)))))
```

5. After `handleAction` (`:63`) — add thread helpers + the post handler:
```ts
  const commentsByRequest = useMemo(() => {
    const map: Record<string, RequestCommentRow[]> = {}
    for (const c of comments) (map[c.request_id] ??= []).push(c)
    return map
  }, [comments])
  const threadCountFor = (requestId: string) => (commentsByRequest[requestId] ?? []).length
  // The full thread lives on the Requests page (RequestDetail). Plain <a href> forces a
  // full navigation so the shell reloads on the requests page and RequestsPage reads ?request=<id>.
  const threadLink = (requestId: string) =>
    `${window.location.pathname.replace(/[^/]+$/, 'requests')}?request=${encodeURIComponent(requestId)}`

  async function saveComment(itemId: string) {
    const item = items.find((it) => it.id === itemId)
    if (!item) return
    const body = (drafts[itemId] ?? '').trim()
    if (!body) return
    setBusyId(itemId)
    try {
      const row = await api.postRequestComment({
        request_id: item.request.id,
        line_item_id: itemId,
        source: 'approvals',
        body,
      })
      api.fireCommentNotification(row.id)
      setDrafts((d) => ({ ...d, [itemId]: '' }))
      setComments(await api.listRequestCommentsMany(Array.from(new Set(items.map((i) => i.request.id)))))
      showToast({ message: 'Comment posted', type: 'success' })
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to post comment', type: 'error' })
    } finally {
      setBusyId(null)
    }
  }
```

6. `:177-201` — replace the entire legacy `{/* Comment editor */}` block with the thread composer (item-scoped, 1000-char cap, "N in thread" chip, deep link):
```tsx
          {/* Comment thread (C2) — posts to the request thread (source 'approvals') */}
          {canComment && (
            <div className="grid gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Comment</label>
                {threadCountFor(item.request.id) > 0 && (
                  <span className="text-[11px] text-muted-foreground">{threadCountFor(item.request.id)} in thread</span>
                )}
              </div>
              <textarea
                rows={2}
                maxLength={1000}
                value={drafts[item.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                placeholder="Add a note for the requester… (max 1000 chars)"
                className="w-full rounded-md border border-input bg-input px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <div className="flex items-center justify-between gap-2">
                <a href={threadLink(item.request.id)} className="text-[11px] text-primary underline">View full thread</a>
                <button
                  type="button"
                  disabled={busyId === item.id || !(drafts[item.id] ?? '').trim()}
                  onClick={() => { void saveComment(item.id) }}
                  className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >Post comment</button>
              </div>
            </div>
          )}
```

Note: the legacy `line_items.admin_comment` editor is retired on this surface — existing `admin_comment` values stay readable (Records fallback, backfilled into the thread by migration 035), and `setLineItemComment` remains in `db.ts` for compatibility (Records no longer calls it — see Task 10).

**Verify:** `npm run build` — tsc passes. Manual: open a request → "Activity" (submitted event + backfilled comment) and "Comments" render; post a comment as staff → success toast, thread updates; "View full thread" on Approvals deep-links to the request.

**Commit:**
```
git add src/requester/RequestDetail.tsx src/pages/ApprovalsPage.tsx
git commit -m "feat(ui): wire Activity timeline + comment thread into RequestDetail; approvals thread composer with deep link; v0.26.0"
```

---

### Task 10: Records history modal + purchasing thread posts — `RecordsPage.tsx`, `ReadyForPurchasing.tsx`, `CreatePurchaseOrderForm.tsx`

**Files:**
- `src/records/RecordsPage.tsx` (MODIFY) — read-only "Latest comment" column, per-item History modal (C1), CSV "Latest comment"
- `src/purchasing/ReadyForPurchasing.tsx` (MODIFY) — post purchase notes as a 'purchasing' thread comment after the order RPC (D5)
- `src/purchasing/CreatePurchaseOrderForm.tsx` (MODIFY) — post PO notes as one 'purchasing' comment per distinct request after PO creation (D5)

**Depends on:** Tasks 4 (db functions), 8 (buildTimeline), 8b (RequestActivity).

#### Edits — `src/records/RecordsPage.tsx`

1. `:1` — add `useMemo`:
```ts
import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
```

2. `:4` — extend the db import:
```ts
import { useProcurementApi, LineItemDetailed, LineItemWithRequest, type RequestCommentRow } from '../data/db'
```

3. After `:9` (the `useFormattingRules` import) — add:
```ts
import { Modal } from '../components/Modal'
import { RequestActivity } from '../components/RequestActivity'
import { buildTimeline } from '../lib/timeline'
```

4. `:59` — remove the `canComment` line (its only use was the old comment editor, which this task replaces):
```ts
  // (deleted) const canComment = hasAppPermission(PERMS.approve) || ...
```

5. State — `:64` keep `names` (now fed from `approved_by` for the History timeline), delete the `:67` `drafts` state (only the old editor used it), and add:
```ts
  const [comments, setComments] = useState<RequestCommentRow[]>([])
  const [historyItem, setHistoryItem] = useState<LineItemDetailed | null>(null)
```

6. `:72-86` — replace the `load` callback (drop `setDrafts` + old `resolveUserNames`; add comments + approver names):
```ts
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listAllLineItemsDetailed(showArchived)
      setItems(data)
      setComments(await api.listRequestCommentsMany(Array.from(new Set(data.map(i => i.request.id)))))
      const approvers = Array.from(new Set(data.map(r => r.approved_by).filter((x): x is string => !!x)))
      if (approvers.length) setNames(await api.resolveUserNames(approvers))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load records')
    } finally {
      setLoading(false)
    }
  }, [])
```

7. `:90-101` — delete `handleSaveComment` (no longer called).

8. After `useEffect(() => { load() }, [load])` (`:88`) — add derived maps + the history timeline memo:
```ts
  // Latest thread comment per item (C2). Legacy admin_comment stays as the fallback.
  const latestByItem = useMemo(() => {
    const map: Record<string, RequestCommentRow> = {}
    for (const c of comments) {
      if (!c.line_item_id) continue
      const cur = map[c.line_item_id]
      if (!cur || c.created_at > cur.created_at) map[c.line_item_id] = c
    }
    return map
  }, [comments])

  const commentsByItem = useMemo(() => {
    const map: Record<string, RequestCommentRow[]> = {}
    for (const c of comments) {
      if (!c.line_item_id) continue
      ;(map[c.line_item_id] ??= []).push(c)
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return map
  }, [comments])

  // Per-item derived timeline for the History modal (C1 — no event log).
  const historyEvents = useMemo(() => {
    if (!historyItem) return []
    return buildTimeline({
      request: historyItem.request,
      items: [historyItem],
      comments: commentsByItem[historyItem.id] ?? [],
      itemName: (li) => li.item_description ?? 'Item',
      nameOf: (id) => names[id] ?? 'Unknown',
    })
  }, [historyItem, commentsByItem, names])
```

9. CSV — `:24` header + `:39` cell + `:23` signature + call site `:152`:
```ts
function exportCsv(rows: LineItemDetailed[], latestByItem: Record<string, RequestCommentRow>) {
  const headers = ['Submitted', 'Requester', 'Email', 'Item', 'Qty', 'Location', 'Department', 'Status', 'Date Needed', 'ETA', 'Request Notes', 'Latest comment']
  ...
      latestByItem[item.id]?.body ?? item.admin_comment ?? '',
  ...
}
```
Call site (`:152`):
```ts
            onClick={() => exportCsv(items, latestByItem)}
```

10. Grid header `:191`:
```tsx
                <th className={head}>Latest comment</th>
```

11. Grid cell `:225-253` — replace the whole editable "Admin Comment" `<td>` with read-only latest comment + History button (column count unchanged):
```tsx
                   <td className={`${cell} min-w-[12rem]`}>
                     <div className="grid gap-1">
                       {(() => {
                         const latest = latestByItem[item.id]
                         const text = latest ? latest.body : (item.admin_comment ?? '')
                         if (!text) return <span className="text-muted-foreground">—</span>
                         return (
                           <span className="break-words">
                             {text}
                             {latest && (
                               <span className="text-[11px] text-muted-foreground"> — {latest.author_name} · {formatDate(latest.created_at)}</span>
                             )}
                           </span>
                         )
                       })()}
                       <button
                         type="button"
                         onClick={() => setHistoryItem(item)}
                         className="justify-self-start inline-flex items-center rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                       >
                         History
                       </button>
                     </div>
                   </td>
```

12. Before the final `</div>` of the root grid (`:296`) — add the History modal:
```tsx
      {historyItem && (
        <Modal
          title={`History — ${historyItem.item_description ?? 'Item'}`}
          onClose={() => setHistoryItem(null)}
        >
          <RequestActivity events={historyEvents} />
        </Modal>
      )}
```

#### Edits — `src/purchasing/ReadyForPurchasing.tsx`

1. `:73-95` `handleSubmit` — after the `api.orderLineItem(...)` call (and the existing notifications), before `showToast`, insert the D5 purchase-notes thread post (best-effort: a comment failure must not fail an already-recorded order):
```ts
      await api.fireNotification('item_ordered', item.request.id, [item.id])
      // C2/D5: post purchase notes to the request thread (source 'purchasing') after the
      // order RPC succeeds. Best-effort — a comment failure never fails the order.
      const note = form.purchase_notes.trim()
      if (note) {
        try {
          const row = await api.postRequestComment({
            request_id: item.request.id,
            line_item_id: item.id,
            source: 'purchasing',
            body: note,
          })
          api.fireCommentNotification(row.id)
        } catch (e) {
          console.error('Failed to post purchase-notes thread comment:', e)
        }
      }
      showToast({ message: 'Order recorded', type: 'success' })
```

2. `:123-130` — pass the distinct request ids of the selected items into the PO form (needed for per-request PO note comments):
```tsx
      {showPoForm && (
        <CreatePurchaseOrderForm
          itemIds={[...selected]}
          requestIds={Array.from(new Set(items.filter(i => selected.has(i.id)).map(i => i.request.id)))}
          locations={locations}
          onCancel={() => setShowPoForm(false)}
          onCreated={async (po) => { setShowPoForm(false); setSelected(new Set()); showToast({ message: `Created ${po.po_number}`, type: 'success' }); await load() }}
        />
      )}
```

#### Edits — `src/purchasing/CreatePurchaseOrderForm.tsx`

1. `:5-12` — extend the props interface + destructure with `requestIds`:
```ts
interface Props {
  itemIds: string[]
  requestIds: string[]
  locations: Location[]
  onCancel: () => void
  onCreated: (po: { id: string; po_number: string }) => void | Promise<void>
}

export function CreatePurchaseOrderForm({ itemIds, requestIds, locations, onCancel, onCreated }: Props) {
```

2. `:24-45` `submit` — after `await api.fireNotification('item_ordered', undefined, itemIds)` and before `await onCreated(po)`, insert the D5 PO-notes thread posts (one 'purchasing' comment per distinct request, `line_item_id` NULL, body includes the PO number; best-effort per request):
```ts
      // C2/D5: post the PO notes to each distinct request thread (source 'purchasing').
      // Bulk POs span requests, so one comment per request; body carries the PO number.
      const note = notes.trim()
      if (note && requestIds.length) {
        for (const reqId of requestIds) {
          try {
            const row = await api.postRequestComment({
              request_id: reqId,
              line_item_id: null,
              source: 'purchasing',
              body: `${note} (PO ${po.po_number})`,
            })
            api.fireCommentNotification(row.id)
          } catch (e) {
            console.error('Failed to post PO thread comment:', e)
          }
        }
      }
      await onCreated(po)
```

**Verify:** `npm run build` — tsc passes (note: `CreatePurchaseOrderForm` is only instantiated in `ReadyForPurchasing.tsx`, so both files change together — build enforces it). Manual: Records → "Latest comment" shows newest thread comment (or legacy `admin_comment`), History modal shows the per-item timeline, CSV exports the "Latest comment" column; Purchasing → Place Order with notes posts a 'purchasing' thread comment; Create PO with notes posts one comment per distinct request.

**Commit:**
```
git add src/records/RecordsPage.tsx src/purchasing/ReadyForPurchasing.tsx src/purchasing/CreatePurchaseOrderForm.tsx
git commit -m "feat(ui): records latest-comment column + per-item history modal; purchasing/PO notes post thread comments; v0.26.0"
```

---

### Task 11: Manifest + version bump — `app.manifest.json`, `package.json`

**Files:**
- `app.manifest.json` (MODIFY)
- `package.json` (MODIFY)

**Edits:**

1. `app.manifest.json:6` — version:
```json
  "version": "0.26.0",
```

2. `app.manifest.json` — `database.migrations[]`: after the version-32 entry (`:66`), add (versions match the file-number prefixes; 33/34 are reserved for the not-yet-merged Waves A/B — the gap is intentional and harmless, ordering is by version number):
```json
      { "version": 32, "description": "Favorites: only approvers/purchasers/admins may insert; trigger stamps created_by for Added-by attribution", "up": "migrations/032_favorite_items_curators.sql" },
      { "version": 35, "description": "Phase 3: request_comments thread table (auto-RLS policies dropped; explicit _service/_read policies) + realtime publication + post_request_comment/get_mention_candidates RPCs + submit_request v5 / submit_request_anon v6 notes-as-comment + legacy admin_comment backfill", "up": "migrations/035_request_comments.sql" },
      { "version": 36, "description": "Phase 3: line_items.last_overdue_reminder_at (14-day overdue-reminder stamp, idempotent ADD COLUMN IF NOT EXISTS)", "up": "migrations/036_last_overdue_reminder_at.sql" },
      { "version": 37, "description": "Phase 3: pg_cron 08:00 keyless overdue-reminder job (pg_net -> edge function; unschedule guard makes re-runs idempotent)", "up": "migrations/037_overdue_cron.sql" }
```

3. `app.manifest.json` — `notifications[]`: after `item_cancelled` (`:84`), add (bell event type `procurement:request_overdue_reminder` is cataloged; the `procurement:comment_added` bell event is intentionally NOT cataloged — comments always bell, no opt-in per spec C2):
```json
      { "key": "item_cancelled", "label": "Item cancelled", "description": "An approved item was cancelled; a new request is needed.", "sort_order": 6 },
      { "key": "request_overdue_reminder", "label": "Request overdue", "description": "A pending or on-hold request has been waiting 14+ days and needs a decision.", "sort_order": 7, "requires_permission": "apps/procurement/approvals/act" }
```

4. **Do NOT** add `request_comments` to `database.tables[]` — the shell's auto-RLS generator would emit conflicting `app_procurement_request_comments_*` policies; migration 035 owns all RLS for that table (decision D2).

5. `package.json:3` — version:
```json
  "version": "0.26.0",
```

**Verify:** `npm run validate` — no errors (manifest schema, notification key regex `^[a-z][a-z0-9_]*$` accepts `request_overdue_reminder`, migration files exist on disk per Tasks 1/6/7).

**Commit:**
```
git add app.manifest.json package.json
git commit -m "chore(release): v0.26.0 manifest — migrations 035-037, request_overdue_reminder notification, version bump; v0.26.0"
```

---

### Task 12: Package, deploy to QA, handoff

**Prereqs:** Tasks 1-11 committed on `for-qa`; QA Supabase project = `jkbqaxpfvqbeepwhunhl`.

**Steps:**

1. Full gate:
```
npm run validate
npm test
npm run build
```
Expected: validator clean; all vitest suites pass (existing + 8 new timeline/mentions tests); tsc clean.

2. Package (strict validator re-runs internally; also bundles ALL `migrations/*.sql` and the edge-function directory automatically):
```
npm run package
```
Expected: `dist/procurement-0.26.0.eitapp`.

3. Remove stale artifacts (repo rule: only the current version's artifact may remain in `dist/`):
```
Remove-Item -LiteralPath "dist\procurement-*.eitapp" -Exclude "procurement-0.26.0.eitapp"
```
(Or list `dist\*.eitapp` and delete any name other than `procurement-0.26.0.eitapp`.)

4. Push:
```
git push origin for-qa
```

5. Upload `dist/procurement-0.26.0.eitapp` via Admin UI → App Management → Publish App (QA portal). publish-app re-applies migrations 1-37 idempotently (035's DROP-policy DO block + CREATE TABLE IF NOT EXISTS guard, 036's ADD COLUMN IF NOT EXISTS, 037's unschedule guard) and upserts `database.config` → `_config.supabase_url` from the project URL (Task 7). If the manifest `config` upsert is not yet supported by the shell version in QA, the manual `_config` seed from Task 7 already covers it.

6. **QA checklist (QA Supabase: `jkbqaxpfvqbeepwhunhl`):**
   1. **Backfill:** `SELECT source, body FROM app_procurement.request_comments WHERE source = 'approvals';` → exactly 1 row (the pre-existing legacy `admin_comment`), visible in the request's thread and in Records' "Latest comment".
   2. **Submit with notes:** new request with request notes → `request_notes` comment appears in the thread (author = requester), and the timeline's first comment matches the notes.
   3. **Approvals comment:** post an item comment on the Approvals page → requester gets email + in-app bell; "N in thread" chip increments; "View full thread" deep-links correctly.
   4. **Requester reply + @mention:** requester replies in the thread mentioning a staff member → email goes ONLY to the mentioned staff member (no email to the requester); bell goes to the newest prior staff commenter.
   5. **Realtime:** two QA browser sessions on the same request → posting in one appears in the other without refresh. (If realtime channel errors, 30 s polling fallback kicks in — verify by disabling the network briefly; acceptable degradation per Risk 1.)
   6. **Purchasing order with notes:** place an order with purchase notes → 'purchasing' comment in the thread + `item_ordered` email (double email on the same event is expected, D7).
   7. **Bulk PO with notes:** create a PO across items from 2 different requests with notes → one 'purchasing' comment per request, each body ending in `(PO <number>)`.
   8. **Overdue reminder:** backdate a pending request (`UPDATE app_procurement.purchase_requests SET submitted_at = now() - interval '15 days' WHERE id = '<id>';`), then trigger the job manually (`SELECT cron.job;` note the jobid; `SELECT cron.run_job(<jobid>);` or wait for 08:00) → approver(s) with `apps/procurement/approvals/act` receive email + bell (`procurement:request_overdue_reminder`); `purchase_requests.last_overdue_reminder_at` is stamped (no duplicate on re-run within 14 days).
   9. **Records:** "Latest comment" column shows newest thread comment (falls back to legacy `admin_comment`); History modal shows the per-item timeline; CSV exports the "Latest comment" header and values.
   10. **RLS spot-check:** as a plain authenticated non-staff user, `SELECT * FROM app_procurement.request_comments` for a request they don't own → 0 rows (request-scoped read policy); `SELECT * FROM app_procurement._config` → permission denied.

7. ClickUp handoff comment (format per repo AGENTS.md):
   - **Header:** `Procurement — Dev update (YYYY-MM-DD): v0.26.0 in progress`
   - **What changed & why:** C1 derived activity timeline (no event log), C2 per-request comment threads with email/bell/realtime/@mentions (request notes, approvals, purchasing/PO notes auto-posted), C3 daily 14-day overdue reminder via keyless pg_cron → edge function.
   - **Expected behavior:** the pass/fail list from the QA checklist above.
   - **How to test it:** QA portal URL (`https://qa.apps.mainspringrecovery.com`), a staff test account with `approvals/act` and a requester test account, steps 1-10.

**Commit:** (no repo changes in this task — the handoff is the ClickUp comment; nothing to commit.)

---

## Self-review checklist (run after all tasks)

- [ ] Spec coverage: C1 (timeline + Records history modal + CSV), C2 (threads, email rules, bell, realtime + poll fallback, @mentions, request-notes-as-comment, purchasing/PO note posts, 1000-char cap), C3 (14-day rule, recipients = approvers, email + bell, stamp, best-effort) — every spec C1/C2/C3 requirement maps to a task.
- [ ] No `TBD`/`TODO`/placeholder code anywhere in the plan.
- [ ] Name/type consistency: `RequestCommentRow`, `MentionCandidate`, `TimelineEvent`, `buildTimeline`, `parseMentions`, `postRequestComment`, `listRequestCommentsMany`, `subscribeRequestComments`, `fireCommentNotification`, `request_overdue_reminder`, `last_overdue_reminder_at`, `035/036/037` used identically across all tasks.
- [ ] Every SQL migration is idempotent (IF NOT EXISTS / DROP IF EXISTS / DO-block guards / unschedule guard).
- [ ] Every commit message ends `; v0.26.0`.
- [ ] `request_comments` absent from manifest `tables[]`.
- [ ] `dist/` contains only `procurement-0.26.0.eitapp` after Task 12.

## Plan commit

Commit ONLY this plan file (the repo pre-commit validator runs `npm run validate` — docs-only changes pass):
```
git add docs/superpowers/plans/2026-08-27-wave-c-comms-history.md
git commit -m "docs: Wave C implementation plan — comment threads, item history timeline, 14-day overdue reminders; v0.26.0"
```
