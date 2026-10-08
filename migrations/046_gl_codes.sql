-- 046: GL code auto-classification (client 18-category list).
-- gl_categories: live admin-managed category list (seeded below; admins add/retire
-- via admin_* RPCs, no migration needed when the list evolves).
-- line_items.gl_code / pre_approved_items.gl_code: denormalized label (TEXT, no FK)
-- so history keeps the label used at the time even if the category is later retired.
-- NULL = unclassified (renders as "—" in the app).
-- Idempotent: publish-app re-applies from the last saved version.

CREATE TABLE IF NOT EXISTS app_procurement.gl_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_procurement.line_items
  ADD COLUMN IF NOT EXISTS gl_code text;
ALTER TABLE app_procurement.pre_approved_items
  ADD COLUMN IF NOT EXISTS gl_code text;

-- Seed the client's 18 categories verbatim (sort_order = client list order).
INSERT INTO app_procurement.gl_categories (code, sort_order) VALUES
  ('Facility: Facility/Building Supplies/In-House Maintenance', 1),
  ('Facility: Small Kitchen equipment, supplies, smallware', 2),
  ('General Office and Administrative Expenses: Small Furniture for Staff Use', 3),
  ('General Office and Administrative Expenses: Office Supplies', 4),
  ('HR & Recruiting: Human Resources Onboarding/ Appreciation/Retention', 5),
  ('IT: Computer Accessories', 6),
  ('Marketing: Alumni Program', 7),
  ('Marketing: Marketing Materials & Promotional/Branded Products', 8),
  ('Medical: Clinical Supplies', 9)
ON CONFLICT (code) DO NOTHING;

INSERT INTO app_procurement.gl_categories (code, sort_order) VALUES
  ('Medical: Medical Supplies', 10),
  ('Medical: Pharmacy and OTC', 11),
  ('Medical: Small Medical Equipment', 12),
  ('Automobile Expense', 13),
  ('Client Services: Small Furniture for Client Use', 14),
  ('Client Services: Food Supplies', 15),
  ('Client Services: Bedding & Towels', 16),
  ('Client Services: Program Expense', 17),
  ('Client Services: Hygiene/personal care', 18)
ON CONFLICT (code) DO NOTHING;

-- RLS (pattern: 023 anon reference read + 033 convergence DO block). Anon sees
-- active categories only (private-form dropdown); authenticated sees active or
-- (admins) everything; NO write policies — all writes go through the admin RPCs.
ALTER TABLE app_procurement.gl_categories ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'app_procurement' AND tablename = 'gl_categories' LOOP EXECUTE format('DROP POLICY %I ON app_procurement.gl_categories', r.policyname); END LOOP; END; $$;
CREATE POLICY gl_categories_anon_read ON app_procurement.gl_categories
  FOR SELECT TO anon USING (active = true);
CREATE POLICY gl_categories_auth_read ON app_procurement.gl_categories
  FOR SELECT TO authenticated USING (active = true OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));

-- submit_request v6 (supersedes 036 v5): identical behavior, plus copies each
-- line item's gl_code from the JSON — validated against ACTIVE categories; a
-- missing/unknown value stores NULL (never blocks the submit).
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
       item_url, item_description, memo, quantity, substitution_ok, date_needed, status, gl_code)
    VALUES (v_id, li->>'ship_to_name', nullif(li->>'location_id','')::uuid, li->>'custom_location',
            nullif(li->>'department_id','')::uuid, li->>'custom_department', li->>'item_url',
            li->>'item_description', li->>'memo', coalesce((li->>'quantity')::int, 1),
            coalesce((li->>'substitution_ok')::boolean, false), nullif(li->>'date_needed','')::date, 'pending',
            (SELECT code FROM gl_categories WHERE active AND code = trim(coalesce(li->>'gl_code','')) LIMIT 1));
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

-- submit_request_anon v7 (supersedes 036 v6): same gl_code handling as v6.
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
       item_url, item_description, memo, quantity, substitution_ok, date_needed, status, gl_code)
    VALUES (v_id, li->>'ship_to_name', nullif(li->>'location_id','')::uuid, li->>'custom_location',
            nullif(li->>'department_id','')::uuid, li->>'custom_department', li->>'item_url',
            li->>'item_description', li->>'memo', coalesce((li->>'quantity')::int, 1),
            coalesce((li->>'substitution_ok')::boolean, false), nullif(li->>'date_needed','')::date, 'pending',
            (SELECT code FROM gl_categories WHERE active AND code = trim(coalesce(li->>'gl_code','')) LIMIT 1));
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

-- order_pre_approved_item v2 (supersedes 034 v1): identical behavior, plus the
-- new line item inherits the catalog entry's gl_code (no AI call in this flow).
CREATE OR REPLACE FUNCTION app_procurement.order_pre_approved_item(
  p_pre_approved_id uuid, p_name text, p_item_url text, p_quantity int,
  p_ship_to_name text, p_location_id uuid, p_custom_location text,
  p_department_id uuid, p_custom_department text, p_date_needed date,
  p_memo text, p_substitution_ok boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_req uuid; v_li uuid;
  v_cat_name text; v_cat_url text; v_cat_gl text;
  v_actor_name text; v_actor_email text;
BEGIN
  IF NOT (public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
          OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
          OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')) THEN
    RAISE EXCEPTION 'Not permitted to order pre-approved items';
  END IF;
  SELECT name, item_url, gl_code INTO v_cat_name, v_cat_url, v_cat_gl
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
     status, approved_by, approval_date, pre_approved_item_id, gl_code)
  VALUES
    (v_req, p_ship_to_name, p_location_id, p_custom_location, p_department_id, p_custom_department,
     nullif(coalesce(p_item_url, v_cat_url), ''), coalesce(nullif(trim(p_name), ''), v_cat_name),
     p_memo, p_quantity, coalesce(p_substitution_ok, false), p_date_needed,
     'approved', auth.uid(), now(), p_pre_approved_id, v_cat_gl)
  RETURNING id INTO v_li;
  PERFORM internal.proc_recompute_request_status(v_req);
  RETURN v_li;
END; $fn$;

-- pre_approve_line_item v4 (supersedes 040 v3): identical catalog-only behavior,
-- plus copies the source item's gl_code into the catalog row (and refreshes it
-- on upsert so re-pre-approving an edited item syncs the catalog).
CREATE OR REPLACE FUNCTION app_procurement.pre_approve_line_item(p_line_item_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_found int; v_cat uuid;
  v_desc text; v_url text; v_qty int; v_subst boolean; v_date date; v_memo text;
  v_loc uuid; v_custom_loc text; v_dept uuid; v_custom_dept text;
  v_img text; v_gl text;
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
         location_id, custom_location, department_id, custom_department, product_image_path, gl_code
    INTO v_desc, v_url, v_qty, v_subst, v_date, v_memo, v_loc, v_custom_loc, v_dept, v_custom_dept, v_img, v_gl
   FROM app_procurement.line_items
   WHERE id = p_line_item_id;
  IF v_desc IS NULL OR trim(v_desc) = '' THEN
    RAISE EXCEPTION 'Item has no description; cannot pre-approve';
  END IF;
  INSERT INTO app_procurement.pre_approved_items
    (name, item_url, quantity, substitution_ok, date_needed, memo, location_id, custom_location, department_id, custom_department, source_line_item_id, product_image_path, gl_code)
  VALUES
    (v_desc, v_url, v_qty, v_subst, v_date, v_memo, v_loc, v_custom_loc, v_dept, v_custom_dept, p_line_item_id, v_img, v_gl)
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
    product_image_path  = EXCLUDED.product_image_path,
    gl_code             = EXCLUDED.gl_code
  RETURNING id INTO v_cat;
  RETURN v_cat;
END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.pre_approve_line_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.pre_approve_line_item(uuid) TO authenticated, service_role;

-- set_line_item_gl_code: requester of the owning request (portal uid, or
-- email match for email-submission requesters) OR admin. NULL/'' clears.
-- Value must be an ACTIVE category (or NULL) — unknown values raise.
CREATE OR REPLACE FUNCTION app_procurement.set_line_item_gl_code(p_line_item_id uuid, p_gl_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_pr purchase_requests;
BEGIN
  SELECT pr.* INTO v_pr
    FROM line_items li
    JOIN purchase_requests pr ON pr.id = li.request_id
   WHERE li.id = p_line_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found'; END IF;
  IF NOT (
    public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
    OR v_pr.requester_id = auth.uid()
    OR (v_pr.requester_id IS NULL
        AND v_pr.requester_email = (SELECT COALESCE(NULLIF(auth.jwt()->>'email',''), up.email)
                                    FROM public.user_profiles up WHERE up.id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Not permitted to edit GL code';
  END IF;
  IF p_gl_code IS NULL OR trim(p_gl_code) = '' THEN
    UPDATE line_items SET gl_code = NULL, updated_at = now() WHERE id = p_line_item_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM gl_categories WHERE active AND code = trim(p_gl_code)) THEN
      RAISE EXCEPTION 'Unknown GL code';
    END IF;
    UPDATE line_items SET gl_code = trim(p_gl_code), updated_at = now() WHERE id = p_line_item_id;
  END IF;
END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.set_line_item_gl_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.set_line_item_gl_code(uuid, text) TO authenticated, service_role;

-- set_pre_approved_gl_code: admin-only catalog GL edit (active code or NULL).
CREATE OR REPLACE FUNCTION app_procurement.set_pre_approved_gl_code(p_id uuid, p_gl_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN
    RAISE EXCEPTION 'Not permitted to edit catalog GL code';
  END IF;
  IF p_gl_code IS NULL OR trim(p_gl_code) = '' THEN
    UPDATE app_procurement.pre_approved_items SET gl_code = NULL WHERE id = p_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM gl_categories WHERE active AND code = trim(p_gl_code)) THEN
      RAISE EXCEPTION 'Unknown GL code';
    END IF;
    UPDATE app_procurement.pre_approved_items SET gl_code = trim(p_gl_code) WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pre-approved item not found'; END IF;
END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.set_pre_approved_gl_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.set_pre_approved_gl_code(uuid, text) TO authenticated, service_role;

-- admin_add_gl_category: admin-only; exact-label (case-sensitive) uniqueness.
CREATE OR REPLACE FUNCTION app_procurement.admin_add_gl_category(p_code text)
RETURNS app_procurement.gl_categories LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE
  v_code text;
  v_row gl_categories;
  v_next int;
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN
    RAISE EXCEPTION 'Not permitted to manage GL categories';
  END IF;
  v_code := trim(coalesce(p_code, ''));
  IF v_code = '' THEN RAISE EXCEPTION 'GL code is required'; END IF;
  IF EXISTS (SELECT 1 FROM gl_categories WHERE code = v_code) THEN
    RAISE EXCEPTION 'GL category already exists';
  END IF;
  SELECT coalesce(max(sort_order), 0) + 1 INTO v_next FROM gl_categories;
  INSERT INTO gl_categories (code, sort_order) VALUES (v_code, v_next) RETURNING * INTO v_row;
  RETURN v_row;
END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.admin_add_gl_category(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.admin_add_gl_category(text) TO authenticated, service_role;

-- admin_set_gl_category_active: admin-only retire/reactivate (no hard deletes —
-- history keeps the label it stored).
CREATE OR REPLACE FUNCTION app_procurement.admin_set_gl_category_active(p_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN
    RAISE EXCEPTION 'Not permitted to manage GL categories';
  END IF;
  UPDATE gl_categories SET active = p_active WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GL category not found'; END IF;
END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.admin_set_gl_category_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.admin_set_gl_category_active(uuid, boolean) TO authenticated, service_role;
