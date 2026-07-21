-- 017: Fix empty request after line item deletion.
-- Also teach cancel_line_item to stamp approved_by so the summary email shows who cancelled.

-- delete_line_item: also delete the parent request if no line items remain.
CREATE OR REPLACE FUNCTION app_procurement.delete_line_item(p_line_item_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_req uuid; v_count int; BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/*') THEN RAISE EXCEPTION 'Only full-access admins can delete items'; END IF; SELECT request_id INTO v_req FROM app_procurement.line_items WHERE id = p_line_item_id; IF v_req IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF; DELETE FROM app_procurement.line_items WHERE id = p_line_item_id; SELECT count(*) INTO v_count FROM app_procurement.line_items WHERE request_id = v_req; IF v_count = 0 THEN DELETE FROM app_procurement.purchase_requests WHERE id = v_req; ELSE PERFORM internal.proc_recompute_request_status(v_req); END IF; END; $fn$;

-- cancel_line_item: stamp approved_by so the summary email shows who cancelled.
CREATE OR REPLACE FUNCTION app_procurement.cancel_line_item(p_line_item_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_req uuid; BEGIN IF NOT (public.check_user_permission(auth.uid(),'apps/procurement/approvals/act') OR public.check_user_permission(auth.uid(),'apps/procurement/purchasing/manage') OR public.check_user_permission(auth.uid(),'apps/procurement/admin/manage')) THEN RAISE EXCEPTION 'Not permitted to cancel'; END IF; UPDATE app_procurement.line_items SET status='cancelled', approved_by=auth.uid(), updated_at=now() WHERE id=p_line_item_id AND status='approved' RETURNING request_id INTO v_req; IF v_req IS NULL THEN RAISE EXCEPTION 'Item not found or not approved'; END IF; PERFORM internal.proc_recompute_request_status(v_req); END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.cancel_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.cancel_line_item(uuid) TO authenticated, service_role;
