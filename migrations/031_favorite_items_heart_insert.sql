-- 031: Heart button on the Requests page (request detail view).
-- Any signed-in user who can view a request item can heart it (INSERT) into
-- the shared favorite_items catalog; it then appears in the Purchasing →
-- Favorites tab (admin-managed) and in the requester form auto-suggest.
-- UPDATE/DELETE stay admin-gated via favorite_items_admin_write (030), so the
-- catalog remains admin-curated for removal/edits.

DROP POLICY IF EXISTS favorite_items_heart_insert ON app_procurement.favorite_items;
CREATE POLICY favorite_items_heart_insert ON app_procurement.favorite_items
  FOR INSERT TO authenticated
  WITH CHECK (true);
