-- 036: Wave C (C2) — request comment threads.
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
    END;
  END IF;
END;
$$;

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
