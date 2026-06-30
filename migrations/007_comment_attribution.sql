-- 007: Phase 3a — line-item comment attribution + wider gate + 100-char cap.
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS commented_by uuid;
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS commented_at timestamptz;
-- Reuse admin_comment for the text. Single-line body (exec_sql splits on ";\n").
CREATE OR REPLACE FUNCTION app_procurement.set_line_item_comment(p_line_item_id uuid, p_comment text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ BEGIN IF NOT (public.check_user_permission(auth.uid(),'apps/procurement/approvals/act') OR public.check_user_permission(auth.uid(),'apps/procurement/purchasing/manage') OR public.check_user_permission(auth.uid(),'apps/procurement/admin/manage')) THEN RAISE EXCEPTION 'Not permitted to comment'; END IF; UPDATE app_procurement.line_items SET admin_comment = left(trim(coalesce(p_comment,'')), 100), commented_by = auth.uid(), commented_at = now(), updated_at = now() WHERE id = p_line_item_id; END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.set_line_item_comment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.set_line_item_comment(uuid, text) TO authenticated, service_role;
