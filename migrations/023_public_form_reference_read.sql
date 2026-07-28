-- Public forms render in anonymous mode, so reference tables needed for dropdowns must be readable by anon.
-- This intentionally allows read-only access to active locations/departments only; no sensitive data is exposed.
DROP POLICY IF EXISTS app_procurement_locations_anon_read ON app_procurement.locations;
CREATE POLICY app_procurement_locations_anon_read ON app_procurement.locations FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS app_procurement_departments_anon_read ON app_procurement.departments;
CREATE POLICY app_procurement_departments_anon_read ON app_procurement.departments FOR SELECT TO anon USING (is_active = true);
