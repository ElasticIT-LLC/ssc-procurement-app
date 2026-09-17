-- SSO users can have a NULL email in auth.users (no email claim in the JWT),
-- which makes the v25 fallback (auth.jwt()->>'email') miss their public/private
-- form submissions. Reference the portal profile email as well so the client
-- filter in RequestsList.tsx (user_profiles.email fallback) is not RLS-blocked.
-- NOTE: PostgreSQL has no CREATE OR REPLACE POLICY; drop then create.

DROP POLICY IF EXISTS app_procurement_purchase_requests_read ON app_procurement.purchase_requests;
CREATE POLICY app_procurement_purchase_requests_read
ON app_procurement.purchase_requests
FOR SELECT
TO authenticated
USING (
  requester_id = auth.uid()
  OR (requester_id IS NULL AND requester_email = (
        SELECT COALESCE(auth.jwt()->>'email', up.email)
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
      ))
  OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
  OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
  OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
);

DROP POLICY IF EXISTS app_procurement_line_items_read ON app_procurement.line_items;
CREATE POLICY app_procurement_line_items_read
ON app_procurement.line_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_procurement.purchase_requests pr
    WHERE pr.id = line_items.request_id
      AND (
        pr.requester_id = auth.uid()
        OR (pr.requester_id IS NULL AND pr.requester_email = (
              SELECT COALESCE(auth.jwt()->>'email', up2.email)
              FROM public.user_profiles up2
              WHERE up2.id = auth.uid()
            ))
        OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
        OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
        OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
      )
  )
);
