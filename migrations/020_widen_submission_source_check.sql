-- Allow 'public_form' as a submission_source value so the public request form can submit successfully.
ALTER TABLE app_procurement.purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_submission_source_check;
ALTER TABLE app_procurement.purchase_requests ADD CONSTRAINT purchase_requests_submission_source_check CHECK (submission_source IN ('in_portal','public_link','public_form'));
