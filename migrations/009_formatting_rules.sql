-- 009: Phase 3b — conditional-formatting rules read RPC.
-- _config read is admin-only (RLS), but every view (incl. non-admin approvers/purchasers) must
-- read the rules to tint rows. This DEFINER RPC returns the rules JSON text to any authenticated
-- user (formatting rules are not sensitive). Admin WRITES still go through _config (admin RLS).
-- Single-line body (exec_sql splits on ";\n").
CREATE OR REPLACE FUNCTION app_procurement.get_formatting_rules() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ SELECT value FROM app_procurement._config WHERE key = 'formatting_rules' LIMIT 1; $fn$;
REVOKE ALL ON FUNCTION app_procurement.get_formatting_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_procurement.get_formatting_rules() TO authenticated, service_role;
