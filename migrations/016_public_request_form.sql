-- Public anonymous request submission.
-- Every CREATE FUNCTION body is ONE physical line (publish-app's exec_sql splits on ";\n").

-- Allow 'anonymous' as a requester_type (keep existing 'portal_user' for backwards compatibility).
ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_requester_type_check;
ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_requester_type_check CHECK (requester_type IN ('portal_user', 'public', 'anonymous'));

-- submit_request_anon: same logic as submit_request but for unauthenticated submitters.
CREATE OR REPLACE FUNCTION app_procurement.submit_request_anon(p_line_items jsonb, p_notes text, p_requester_email text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_id uuid; li jsonb; BEGIN INSERT INTO app_procurement.purchase_requests (requester_id, requester_name, requester_email, requester_type, submission_source, status, notes, submitted_at) VALUES (null, null, p_requester_email, 'anonymous', 'public_form', 'pending', p_notes, now()) RETURNING id INTO v_id; FOR li IN SELECT * FROM jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) LOOP INSERT INTO app_procurement.line_items (request_id, ship_to_name, location_id, custom_location, department_id, custom_department, item_url, item_description, memo, quantity, substitution_ok, date_needed, status) VALUES (v_id, li->>'ship_to_name', nullif(li->>'location_id','')::uuid, li->>'custom_location', nullif(li->>'department_id','')::uuid, li->>'custom_department', li->>'item_url', li->>'item_description', li->>'memo', coalesce((li->>'quantity')::int,1), coalesce((li->>'substitution_ok')::boolean,false), nullif(li->>'date_needed','')::date, 'pending'); END LOOP; PERFORM internal.proc_recompute_request_status(v_id); RETURN v_id; END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.submit_request_anon(jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.submit_request_anon(jsonb, text, text) TO anon, authenticated, service_role;

-- Allow anonymous inserts (writes go through the SECURITY DEFINER RPC above).
DROP POLICY IF EXISTS purchase_requests_anon_insert ON app_procurement.purchase_requests;
CREATE POLICY purchase_requests_anon_insert ON app_procurement.purchase_requests FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS line_items_anon_insert ON app_procurement.line_items;
CREATE POLICY line_items_anon_insert ON app_procurement.line_items FOR INSERT TO anon WITH CHECK (true);
