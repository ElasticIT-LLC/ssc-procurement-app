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
