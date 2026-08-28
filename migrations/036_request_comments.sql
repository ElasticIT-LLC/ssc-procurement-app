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
