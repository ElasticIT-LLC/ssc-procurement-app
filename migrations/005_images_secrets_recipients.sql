-- 005: Phase 2a — private product-images bucket, vault secret reader, approver recipient RPC.

-- Private bucket for product screenshots (idempotent).
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images','product-images', false) ON CONFLICT (id) DO NOTHING;

-- Storage RLS: service_role writes; authenticated may read (signed-URL display). Paths are UUIDs; content is product screenshots, not PII.
-- storage.objects is owned by supabase_storage_admin on current Supabase projects, so the
-- migration runner (postgres) may not be able to manage its policies. If we own the table we
-- (re)create them; otherwise require them to already exist (created once via the dashboard SQL
-- editor as supabase_admin) and fail loudly if missing so images never silently 403.
DO $do$
BEGIN
  BEGIN
    DROP POLICY IF EXISTS product_images_service_write ON storage.objects;
    CREATE POLICY product_images_service_write ON storage.objects FOR ALL TO service_role USING (bucket_id = 'product-images') WITH CHECK (bucket_id = 'product-images');
    DROP POLICY IF EXISTS product_images_auth_read ON storage.objects;
    CREATE POLICY product_images_auth_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-images');
  EXCEPTION WHEN insufficient_privilege THEN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'product_images_service_write')
       AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'product_images_auth_read') THEN
      RAISE NOTICE 'product-images storage policies already exist; skipping recreation';
    ELSE
      RAISE EXCEPTION 'product-images storage policies missing and role "%" does not own storage.objects; create product_images_service_write + product_images_auth_read as supabase_admin in the dashboard SQL editor, then re-upload', current_user;
    END IF;
  END;
END
$do$;

-- Service-role-only secret reader (PG Vault). Single-line body. Lints 0028/0029 do not fire because anon/authenticated cannot execute it.
CREATE OR REPLACE FUNCTION public.get_app_secret(p_name text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, public AS $fn$ DECLARE v_secret text; BEGIN SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1; RETURN v_secret; EXCEPTION WHEN OTHERS THEN RETURN NULL; END; $fn$;
REVOKE ALL ON FUNCTION public.get_app_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_secret(text) TO service_role;

-- Service-role-only: emails+ids of users holding a permission key (wildcard-aware via the shell's check_user_permission). Single-line body.
CREATE OR REPLACE FUNCTION app_procurement.get_permission_holders(p_permission text) RETURNS TABLE(user_id uuid, email text) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$ SELECT DISTINCT up.id, up.email FROM public.user_profiles up WHERE up.email IS NOT NULL AND up.email <> '' AND public.check_user_permission(up.id, p_permission) ORDER BY up.email; $fn$;
REVOKE ALL ON FUNCTION app_procurement.get_permission_holders(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_procurement.get_permission_holders(text) TO service_role;
