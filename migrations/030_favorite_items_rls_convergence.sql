-- 030: Converge favorite_items RLS to the canonical policy set.
-- Migration 029 was applied to QA before its legacy-policy drops existed, so
-- loose per-action policies (any authenticated user could insert/update/delete)
-- are still active there. This drops every non-service policy and recreates
-- the canonical set, so all environments converge on:
--   read: any authenticated user (requester form auto-suggest)
--   write: apps/procurement/admin/manage holders only (system admins included)

DROP POLICY IF EXISTS app_procurement_favorite_items_read ON app_procurement.favorite_items;
DROP POLICY IF EXISTS app_procurement_favorite_items_insert ON app_procurement.favorite_items;
DROP POLICY IF EXISTS app_procurement_favorite_items_update ON app_procurement.favorite_items;
DROP POLICY IF EXISTS app_procurement_favorite_items_delete ON app_procurement.favorite_items;
DROP POLICY IF EXISTS favorite_items_read_all ON app_procurement.favorite_items;
DROP POLICY IF EXISTS favorite_items_admin_write ON app_procurement.favorite_items;

CREATE POLICY favorite_items_read_all ON app_procurement.favorite_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY favorite_items_admin_write ON app_procurement.favorite_items
  FOR ALL TO authenticated
  USING (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'))
  WITH CHECK (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));
