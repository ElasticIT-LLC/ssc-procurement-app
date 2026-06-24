-- Seed data for local development environment
-- This runs after shell migrations have been applied

-- Promote the admin user (handle_new_user trigger creates them with role='user')
-- Also set display_name so the sidebar shows "Local Admin" instead of falling
-- back to the email "admin@localhost" (which wraps awkwardly in the user pill
-- at the bottom of the sidebar). Production portals get this from Entra ID's
-- profile claims; local-dev never wrote one because the seed only updated
-- role.
UPDATE user_profiles
   SET role = 'admin',
       display_name = 'Local Admin'
 WHERE email = 'admin@localhost';

-- Register the app in the apps table
INSERT INTO apps (slug, name, icon, status, loading_mode)
VALUES ('my-app', 'My App', 'Puzzle', 'active', 'native')
ON CONFLICT (slug) DO UPDATE SET status = 'active';

-- NOTE: We deliberately do NOT seed roles or role assignments here. Production
-- behavior (shell v0.12.0+) is that admins create roles manually via Admin →
-- Roles after the app is installed; auto-generated "Full Access" / "Viewer"
-- roles were removed. Local-dev mirrors that. To exercise the user/viewer
-- accounts, sign in as admin@localhost first and create the roles you need.

-- Client settings
INSERT INTO client_settings (key, value)
VALUES ('client_name', 'Local Development Portal')
ON CONFLICT (key) DO NOTHING;

-- Hide ElasticIT-internal bundled apps from the local-dev sidebar.
-- The shell's useAppSync hook (in @elasticit-llc/shell) merges a default
-- appRegistry with the user's config; the defaults include some apps
-- bundled with ElasticIT client portals that should NOT appear in the
-- local-dev test environment. Since the spread-merge means user config
-- can't remove defaults, we intercept registrations at the DB layer
-- and mark them deleted on insert. The Sidebar component filters by
-- `deleted_at IS NULL`, so they never render.
CREATE OR REPLACE FUNCTION public.local_dev_hide_internal_apps()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.slug IN ('printix', 'screening') THEN
    NEW.deleted_at := NOW();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS local_dev_hide_internal_apps_trg ON public.apps;
CREATE TRIGGER local_dev_hide_internal_apps_trg
  BEFORE INSERT OR UPDATE ON public.apps
  FOR EACH ROW
  EXECUTE FUNCTION public.local_dev_hide_internal_apps();

-- Pre-soft-delete any rows that already exist (from a previous boot
-- where useAppSync ran before this trigger was installed).
UPDATE public.apps SET deleted_at = NOW()
WHERE slug IN ('printix', 'screening')
  AND deleted_at IS NULL;

-- Auto-expose schema-mode app schemas to PostgREST.
--
-- Production client portals do this via the publish-app edge function
-- calling the Supabase Management API to append `app_<slug>` to
-- `pgrst.db_schemas` and trigger a schema-cache reload. The Management
-- API isn't available against local Supabase, so without this trigger
-- a schema-mode `.eitapp` upload registers the app row + creates the
-- schema + tables, but PostgREST refuses queries with
-- "Could not find the table 'app_<slug>.<table>' in the schema cache."
--
-- This AFTER-INSERT/UPDATE trigger fires whenever the apps table gains
-- a schema-mode app, reads the current `authenticator` role's
-- `pgrst.db_schemas` setting, appends the new schema if missing, and
-- notifies PostgREST to reload both config and schema cache. The result
-- is that a freshly-uploaded schema-mode app's tables are queryable
-- immediately — no manual SQL needed by the developer.
--
-- SECURITY DEFINER is required because ALTER ROLE is a privileged op;
-- declaring the function as such lets it run as the postgres superuser
-- regardless of which role triggered the apps-table insert.
CREATE OR REPLACE FUNCTION public.local_dev_expose_app_schema()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_schema     text;
  v_setconfig  text[];
  v_current    text;
  v_new        text;
BEGIN
  v_schema := NEW.schema_config->>'schema_name';
  IF NEW.db_mode IS DISTINCT FROM 'schema' OR v_schema IS NULL OR v_schema = '' THEN
    RETURN NEW;
  END IF;

  -- Pull the current role-level setting array. Each element looks like
  -- "param=value"; we want the one starting with "pgrst.db_schemas=".
  SELECT setconfig INTO v_setconfig
  FROM pg_db_role_setting
  JOIN pg_roles ON pg_roles.oid = setrole
  WHERE rolname = 'authenticator';

  -- Find the current pgrst.db_schemas value, or default if unset.
  v_current := COALESCE(
    (SELECT replace(s, 'pgrst.db_schemas=', '')
     FROM unnest(v_setconfig) AS s
     WHERE s LIKE 'pgrst.db_schemas=%' LIMIT 1),
    'public, graphql_public, storage'
  );

  -- Already in the list — nothing to do (avoids redundant ALTER + reload).
  IF position(v_schema IN v_current) > 0 THEN
    RETURN NEW;
  END IF;

  v_new := v_current || ', ' || v_schema;
  EXECUTE format('ALTER ROLE authenticator SET pgrst.db_schemas = %L', v_new);
  PERFORM pg_notify('pgrst', 'reload config');
  PERFORM pg_notify('pgrst', 'reload schema');
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS local_dev_expose_app_schema_trg ON public.apps;
CREATE TRIGGER local_dev_expose_app_schema_trg
  AFTER INSERT OR UPDATE OF db_mode, schema_config ON public.apps
  FOR EACH ROW
  EXECUTE FUNCTION public.local_dev_expose_app_schema();
