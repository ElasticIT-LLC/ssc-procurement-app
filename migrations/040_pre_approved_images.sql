-- 040: z8ygbxp4ce — product image on the pre-approved catalog.
-- Adds product_image_path, makes pre_approve_line_item copy it from the source
-- line item, and backfills existing catalog rows from their source items.
-- Idempotent: publish-app re-applies from the last saved version.

ALTER TABLE app_procurement.pre_approved_items
  ADD COLUMN IF NOT EXISTS product_image_path text;

-- pre_approve_line_item v3 (supersedes 035): identical catalog-only behavior,
-- plus copies the source item's product_image_path into the catalog row.
CREATE OR REPLACE FUNCTION app_procurement.pre_approve_line_item(p_line_item_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_found int; v_cat uuid;
  v_desc text; v_url text; v_qty int; v_subst boolean; v_date date; v_memo text;
  v_loc uuid; v_custom_loc text; v_dept uuid; v_custom_dept text;
  v_img text;
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
         location_id, custom_location, department_id, custom_department, product_image_path
    INTO v_desc, v_url, v_qty, v_subst, v_date, v_memo, v_loc, v_custom_loc, v_dept, v_custom_dept, v_img
   FROM app_procurement.line_items
   WHERE id = p_line_item_id;
  IF v_desc IS NULL OR trim(v_desc) = '' THEN
    RAISE EXCEPTION 'Item has no description; cannot pre-approve';
  END IF;
  INSERT INTO app_procurement.pre_approved_items
    (name, item_url, quantity, substitution_ok, date_needed, memo, location_id, custom_location, department_id, custom_department, source_line_item_id, product_image_path)
  VALUES
    (v_desc, v_url, v_qty, v_subst, v_date, v_memo, v_loc, v_custom_loc, v_dept, v_custom_dept, p_line_item_id, v_img)
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
    source_line_item_id = EXCLUDED.source_line_item_id,
    product_image_path  = EXCLUDED.product_image_path
  RETURNING id INTO v_cat;
  RETURN v_cat;
END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.pre_approve_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.pre_approve_line_item(uuid) TO authenticated, service_role;

-- One-time backfill: give existing catalog rows the source item's image.
UPDATE app_procurement.pre_approved_items p
   SET product_image_path = li.product_image_path
  FROM app_procurement.line_items li
 WHERE p.source_line_item_id = li.id
   AND li.product_image_path IS NOT NULL
   AND p.product_image_path IS NULL;
