-- 008: Phase 3a fix — server-side commenter-name resolver.
--
-- public.user_profiles SELECT policy (profiles_read) = "id = auth.uid() OR internal.is_admin()",
-- so a non-admin client can only read their OWN profile. The comment-attribution UI must show
-- OTHER users' names, so resolve them via this SECURITY DEFINER RPC (bypasses that RLS), scoped
-- to procurement actors. Returns display_name (falling back to email) for the given ids only.
-- Single-line body (publish-app exec_sql splits on ";\n").
CREATE OR REPLACE FUNCTION app_procurement.get_user_names(p_ids uuid[]) RETURNS TABLE(id uuid, display_name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$ BEGIN IF NOT (public.check_user_permission(auth.uid(),'apps/procurement/approvals/act') OR public.check_user_permission(auth.uid(),'apps/procurement/purchasing/manage') OR public.check_user_permission(auth.uid(),'apps/procurement/admin/manage')) THEN RETURN; END IF; RETURN QUERY SELECT up.id, coalesce(nullif(up.display_name,''), up.email) FROM public.user_profiles up WHERE up.id = ANY(p_ids); END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.get_user_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_procurement.get_user_names(uuid[]) TO authenticated, service_role;
