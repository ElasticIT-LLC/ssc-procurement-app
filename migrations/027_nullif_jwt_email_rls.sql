-- SSO (Entra ID) users have auth.users.email = NULL, so GoTrue issues their
-- JWT with an EMPTY email claim ("email": ""), not a null one. COALESCE does
-- not fall through on an empty string, which broke the v25/v26 email fallback:
-- COALESCE('', profile.email) = '' and no requester_email matches ''.
-- Normalize the empty claim to NULL before coalescing to the profile email.
-- Native (email/password) users keep the JWT email as the source of truth.
-- NOTE: PostgreSQL has no CREATE OR REPLACE POLICY; drop then create.

DROP POLICY IF EXISTS app_procurement_purchase_requests_read ON app_procurement.purchase_requests;
CREATE POLICY app_procurement_purchase_requests_read
ON app_procurement.purchase_requests
FOR SELECT
TO authenticated
USING (
  requester_id = auth.uid()
  OR (requester_id IS NULL AND requester_email = (
        SELECT COALESCE(NULLIF(auth.jwt()->>'email', ''), up.email)
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
              SELECT COALESCE(NULLIF(auth.jwt()->>'email', ''), up2.email)
              FROM public.user_profiles up2
              WHERE up2.id = auth.uid()
            ))
        OR public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
        OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
        OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
      )
  )
);
