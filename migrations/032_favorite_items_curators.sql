-- 032: Favorites curation tightening + "Added by" attribution.
-- 1) Only approvers, purchasers, and admins may INSERT into favorite_items
--    (replaces 031's any-authenticated heart insert). Reads stay open to all
--    authenticated users (029); UPDATE/DELETE stay admin-only (030).
-- 2) BEFORE INSERT trigger stamps created_by with the inserting user so the
--    "Added by" column is populated going forward (legacy rows stay NULL).

DROP POLICY IF EXISTS favorite_items_heart_insert ON app_procurement.favorite_items;
CREATE POLICY favorite_items_curator_insert ON app_procurement.favorite_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.check_user_permission(auth.uid(), 'apps/procurement/approvals/act')
    OR public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
    OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
  );

CREATE OR REPLACE FUNCTION app_procurement.set_favorite_item_creator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_favorite_items_set_creator ON app_procurement.favorite_items;
CREATE TRIGGER trg_favorite_items_set_creator
  BEFORE INSERT ON app_procurement.favorite_items
  FOR EACH ROW
  EXECUTE FUNCTION app_procurement.set_favorite_item_creator();
