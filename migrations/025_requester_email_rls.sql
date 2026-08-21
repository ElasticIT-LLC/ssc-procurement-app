-- Allow requesters to read their own requests even when requester_id is NULL
-- (e.g., public/private form submissions that only captured an email address).
-- This matches the client-side filter in RequestsList.tsx.

CREATE OR REPLACE POLICY app_procurement_purchase_requests_read
ON app_procurement.purchase_requests
FOR SELECT
TO authenticated
USING (
  requester_id = auth.uid()
  OR (requester_id IS NULL AND requester_email = auth.jwt()->>'email')
  OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
  OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
  OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
);

CREATE OR REPLACE POLICY app_procurement_line_items_read
ON app_procurement.line_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_procurement.purchase_requests pr
    WHERE pr.id = line_items.request_id
      AND (
        pr.requester_id = auth.uid()
        OR (pr.requester_id IS NULL AND pr.requester_email = auth.jwt()->>'email')
        OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
        OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
        OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
      )
  )
);
