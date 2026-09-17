-- 035: Wave B fix (dev sign-off 2026-08-28) - pre_approve_line_item is CATALOG-ONLY.
-- Pre-approving no longer approves the item: it only upserts the standing
-- pre-approved catalog entry (unique on lower(name)) from the item's request-form
-- fields. The line item keeps its current status (pending/on_hold), stays in the
-- For Approval queue, and still needs the normal Approve action to move forward.
-- Permission gate, pending/on_hold scope, and the description guard are unchanged.
-- Idempotent: publish-app re-applies from the last saved version.

CREATE OR REPLACE FUNCTION app_procurement.pre_approve_line_item(p_line_item_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_found int; v_cat uuid;
  v_desc text; v_url text; v_qty int; v_subst boolean; v_date date; v_memo text;
  v_loc uuid; v_custom_loc text; v_dept uuid; v_custom_dept text;
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act') THEN
    RAISE EXCEPTION 'Not permitted to pre-approve';
  END IF;
  SELECT count(*) INTO v_found
    FROM app_procurement.line_items
   WHERE id = p_line_item_id AND status IN ('pending','on_hold');
  IF v_found = 0 THEN
    RAISE EXCEPTION 'Item not found or not in a decidable state';
  END IF;
  SELECT item_description, item_url, quantity, substitution_ok, date_needed, memo,
         location_id, custom_location, department_id, custom_department
    INTO v_desc, v_url, v_qty, v_subst, v_date, v_memo, v_loc, v_custom_loc, v_dept, v_custom_dept
   FROM app_procurement.line_items
   WHERE id = p_line_item_id;
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
  RETURN v_cat;
END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.pre_approve_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.pre_approve_line_item(uuid) TO authenticated, service_role;
