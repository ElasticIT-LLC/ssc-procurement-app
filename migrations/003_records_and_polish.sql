-- Records details + Phase-1 polish.
-- Every CREATE FUNCTION body is ONE physical line (publish-app's exec_sql splits on ";\n").

-- Per-line-item admin comment, edited from the Records page.
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS admin_comment text;

-- submit_request (v3): identical to migration 002 but also stamps requester_name/email from public.user_profiles so staff views show who requested.
CREATE OR REPLACE FUNCTION app_procurement.submit_request(p_notes text, p_line_items jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_id uuid; v_name text; v_email text; li jsonb; BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/requests/create') THEN RAISE EXCEPTION 'Not permitted to create requests'; END IF; SELECT up.display_name, up.email INTO v_name, v_email FROM public.user_profiles up WHERE up.id = auth.uid(); INSERT INTO app_procurement.purchase_requests (requester_id, requester_name, requester_email, requester_type, submission_source, status, notes, submitted_at) VALUES (auth.uid(), v_name, v_email, 'portal_user', 'in_portal', 'pending', p_notes, now()) RETURNING id INTO v_id; FOR li IN SELECT * FROM jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) LOOP INSERT INTO app_procurement.line_items (request_id, ship_to_name, location_id, custom_location, department_id, custom_department, item_url, item_description, memo, quantity, substitution_ok, date_needed, status) VALUES (v_id, li->>'ship_to_name', nullif(li->>'location_id','')::uuid, li->>'custom_location', nullif(li->>'department_id','')::uuid, li->>'custom_department', li->>'item_url', li->>'item_description', li->>'memo', coalesce((li->>'quantity')::int,1), coalesce((li->>'substitution_ok')::boolean,false), nullif(li->>'date_needed','')::date, 'pending'); END LOOP; RETURN v_id; END; $fn$;

-- Backfill requester name/email on pre-existing requests that never captured them.
UPDATE app_procurement.purchase_requests pr SET requester_name = up.display_name, requester_email = up.email FROM public.user_profiles up WHERE pr.requester_id = up.id AND pr.requester_email IS NULL;

-- set_line_item_comment: admins (admin/manage) set/clear the per-item admin comment.
CREATE OR REPLACE FUNCTION app_procurement.set_line_item_comment(p_line_item_id uuid, p_comment text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN RAISE EXCEPTION 'Not permitted to edit comments'; END IF; UPDATE app_procurement.line_items SET admin_comment = p_comment, updated_at = now() WHERE id = p_line_item_id; END; $fn$;

-- delete_line_item: full-access admins only; recompute the parent request status after delete.
CREATE OR REPLACE FUNCTION app_procurement.delete_line_item(p_line_item_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_req uuid; BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/*') THEN RAISE EXCEPTION 'Only full-access admins can delete items'; END IF; SELECT request_id INTO v_req FROM app_procurement.line_items WHERE id = p_line_item_id; IF v_req IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF; DELETE FROM app_procurement.line_items WHERE id = p_line_item_id; PERFORM internal.proc_recompute_request_status(v_req); END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.set_line_item_comment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.set_line_item_comment(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app_procurement.delete_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.delete_line_item(uuid) TO authenticated, service_role;
