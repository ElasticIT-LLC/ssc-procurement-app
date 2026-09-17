-- 029: Favorite items — admin-curated catalog of standard items, surfaced as
-- auto-suggestions in the request forms' Item Name field. Single shared list
-- (not per-user): admins add/remove; every authenticated form user gets
-- suggestions; anonymous public-form visitors get plain text (no RLS read).

CREATE TABLE IF NOT EXISTS app_procurement.favorite_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  item_url   text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive duplicate-name protection (expression constraint via index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_favorite_items_name ON app_procurement.favorite_items (lower(name));

ALTER TABLE app_procurement.favorite_items ENABLE ROW LEVEL SECURITY;

-- Drop any previously auto-generated permissive policies (any-authenticated
-- could write). Keep the service_role ALL policy if present.
DROP POLICY IF EXISTS app_procurement_favorite_items_insert ON app_procurement.favorite_items;
DROP POLICY IF EXISTS app_procurement_favorite_items_update ON app_procurement.favorite_items;
DROP POLICY IF EXISTS app_procurement_favorite_items_delete ON app_procurement.favorite_items;
DROP POLICY IF EXISTS app_procurement_favorite_items_read ON app_procurement.favorite_items;

DROP POLICY IF EXISTS favorite_items_read_all ON app_procurement.favorite_items;
CREATE POLICY favorite_items_read_all ON app_procurement.favorite_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS favorite_items_admin_write ON app_procurement.favorite_items;
CREATE POLICY favorite_items_admin_write ON app_procurement.favorite_items
  FOR ALL TO authenticated
  USING (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'))
  WITH CHECK (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));
