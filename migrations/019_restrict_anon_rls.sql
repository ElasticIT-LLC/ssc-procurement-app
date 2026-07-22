-- Restrict anon INSERT policies so they only allow public-form submissions (requester_type='anonymous' AND submission_source='public_form'), fixing the RLS advisor warnings about overly permissive WITH CHECK (true).
DROP POLICY IF EXISTS purchase_requests_anon_insert ON app_procurement.purchase_requests;
CREATE POLICY purchase_requests_anon_insert ON app_procurement.purchase_requests FOR INSERT TO anon WITH CHECK (requester_type = 'anonymous' AND submission_source = 'public_form');
DROP POLICY IF EXISTS line_items_anon_insert ON app_procurement.line_items;
CREATE POLICY line_items_anon_insert ON app_procurement.line_items FOR INSERT TO anon WITH CHECK (EXISTS (SELECT 1 FROM app_procurement.purchase_requests pr WHERE pr.id = line_items.request_id AND pr.requester_type = 'anonymous' AND pr.submission_source = 'public_form'));
