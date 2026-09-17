-- 033: Wave B — pre-approved items catalog + line_items reporting columns.
-- The catalog is a standing template: pre-approving a request item upserts a
-- catalog row (unique on lower(name)); ordering from the catalog creates a
-- brand-new request, so the catalog row is never consumed.
-- Reporting columns on line_items: received_at/cancelled_at lifecycle stamps
-- (stamped by the 034 receive/cancel RPC recreations) and pre_approved_item_id
-- (re-order linkage). Idempotent: publish-app re-applies from the last saved
-- version, so every object is dropped/recreated safely.

CREATE TABLE IF NOT EXISTS app_procurement.pre_approved_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  item_url text,
  quantity int NOT NULL DEFAULT 1,
  substitution_ok boolean NOT NULL DEFAULT false,
  date_needed date,
  memo text,
  location_id uuid REFERENCES app_procurement.locations(id),
  custom_location text,
  department_id uuid REFERENCES app_procurement.departments(id),
  custom_department text,
  source_line_item_id uuid,               -- item it was pre-approved from (report lineage)
  created_by uuid,                        -- stamped by trigger (pattern: favorite_items 032)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pre_approved_name ON app_procurement.pre_approved_items (lower(name));

ALTER TABLE app_procurement.line_items
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_approved_item_id uuid REFERENCES app_procurement.pre_approved_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_line_items_pre_approved ON app_procurement.line_items (pre_approved_item_id);

-- RLS (pattern: favorite_items 029-032): SELECT for any authenticated user
-- (app visibility is gated upstream); NO INSERT/UPDATE policies so direct
-- writes are denied (all writes go through the SECURITY DEFINER RPCs in 034);
-- DELETE admin-only. The DO block first drops ANY existing policies on the
-- table (including platform auto-generated permissive ones) so every
-- environment converges on exactly the two canonical policies.
ALTER TABLE app_procurement.pre_approved_items ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'app_procurement' AND tablename = 'pre_approved_items' LOOP EXECUTE format('DROP POLICY %I ON app_procurement.pre_approved_items', r.policyname); END LOOP; END; $$;
CREATE POLICY pre_approved_items_read_all ON app_procurement.pre_approved_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY pre_approved_items_delete_admin ON app_procurement.pre_approved_items
  FOR DELETE TO authenticated
  USING (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));

-- Stamp created_by on insert (pattern: favorite_items 032).
CREATE OR REPLACE FUNCTION app_procurement.set_pre_approved_item_creator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pre_approved_items_set_creator ON app_procurement.pre_approved_items;
CREATE TRIGGER trg_pre_approved_items_set_creator
  BEFORE INSERT ON app_procurement.pre_approved_items
  FOR EACH ROW
  EXECUTE FUNCTION app_procurement.set_pre_approved_item_creator();
