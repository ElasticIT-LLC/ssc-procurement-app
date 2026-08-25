-- 028: Records archive (soft delete). archived_at = NULL means active.
-- Records management only: does NOT change item/request status or rollups.
-- Replaces the UI Delete button; the hard-delete RPC (delete_line_item) is
-- intentionally left in place for DB-level use.

ALTER TABLE app_procurement.line_items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION app_procurement.archive_line_item(
  p_line_item_id uuid,
  p_archived boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app_procurement, public AS $fn$
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/*') THEN
    RAISE EXCEPTION 'Only full-access admins can archive items';
  END IF;

  UPDATE app_procurement.line_items
     SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
         updated_at  = now()
   WHERE id = p_line_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.archive_line_item(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_procurement.archive_line_item(uuid, boolean) TO authenticated, service_role;
