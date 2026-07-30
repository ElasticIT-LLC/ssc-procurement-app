-- Allow submit_request_anon to record the requester's display name so private-form emails show a name instead of an email address.
-- Public/anonymous submissions can still pass NULL for requester_name.

-- Drop the previous 3-argument signature so there is no ambiguity between the old and new overloads.
DROP FUNCTION IF EXISTS app_procurement.submit_request_anon(jsonb, text, text);

CREATE OR REPLACE FUNCTION app_procurement.submit_request_anon(p_line_items jsonb, p_notes text, p_requester_email text, p_requester_name text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_id uuid; li jsonb; BEGIN INSERT INTO app_procurement.purchase_requests (requester_id, requester_name, requester_email, requester_type, submission_source, status, notes, submitted_at) VALUES (null, p_requester_name, p_requester_email, 'anonymous', 'public_form', 'pending', p_notes, now()) RETURNING id INTO v_id; FOR li IN SELECT * FROM jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) LOOP INSERT INTO app_procurement.line_items (request_id, ship_to_name, location_id, custom_location, department_id, custom_department, item_url, item_description, memo, quantity, substitution_ok, date_needed, status) VALUES (v_id, li->>'ship_to_name', nullif(li->>'location_id','')::uuid, li->>'custom_location', nullif(li->>'department_id','')::uuid, li->>'custom_department', li->>'item_url', li->>'item_description', li->>'memo', coalesce((li->>'quantity')::int,1), coalesce((li->>'substitution_ok')::boolean,false), nullif(li->>'date_needed','')::date, 'pending'); END LOOP; PERFORM internal.proc_recompute_request_status(v_id); RETURN v_id; END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.submit_request_anon(jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.submit_request_anon(jsonb, text, text, text) TO anon, authenticated, service_role;
