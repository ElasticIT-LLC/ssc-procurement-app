-- 043: z8ygbxp4cg — allow status changes after a decision has been made.
-- Extends decide_line_item so an already-approved item can be re-decided:
--   approved -> declined | on_hold | pending   (undo the approval)
-- Guarded to items not yet ordered: po_id IS NULL. Once an item is on a PO
-- (status 'ordered'), the existing cancel_line_item path is the only exit.
-- Undoing an approval (action 'pending') clears approved_by/approval_date so
-- the item returns to the For Approval queue with no stale decision metadata.
-- All existing behavior (pending/on_hold -> approved/declined/on_hold) is
-- unchanged. Idempotent: CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION app_procurement.decide_line_item(p_line_item_id uuid, p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_req uuid; BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act') THEN RAISE EXCEPTION 'Not permitted to approve'; END IF; IF p_action NOT IN ('approved','declined','on_hold','pending') THEN RAISE EXCEPTION 'Invalid action'; END IF; UPDATE app_procurement.line_items SET status = p_action, approved_by = CASE WHEN p_action = 'pending' THEN NULL ELSE auth.uid() END, approval_date = CASE WHEN p_action = 'pending' THEN NULL ELSE now() END, updated_at = now() WHERE id = p_line_item_id AND (status IN ('pending','on_hold') AND p_action IN ('approved','declined','on_hold') OR status = 'approved' AND po_id IS NULL AND p_action IN ('declined','on_hold','pending')) RETURNING request_id INTO v_req; IF v_req IS NULL THEN RAISE EXCEPTION 'Item not found or not in a decidable state'; END IF; PERFORM internal.proc_recompute_request_status(v_req); END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.decide_line_item(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.decide_line_item(uuid, text) TO authenticated, service_role;
