-- 045: Supabase security-advisor remediation for the procurement trigger
-- functions (linter 0011 function_search_path_mutable + 0028/0029
-- anon/authenticated SECURITY DEFINER executable). Applied directly to all
-- four projects (MSR/SSC x QA/PROD) on 2026-10-07; shipped here so fresh
-- installs and future publishes converge on the same definitions.
--
--   * SET search_path added to the four trigger functions. Bodies are
--     byte-identical to the 032/033/041/042 definitions (verified no drift
--     on all projects before applying). CREATE OR REPLACE preserves the
--     OID, so the attached triggers (trg_check_date_needed,
--     trg_favorite_items_set_creator, trg_pre_approved_items_set_creator,
--     trg_procurement_submit) are unaffected.
--   * EXECUTE on public.trigger_procurement_submit() revoked from
--     anon/authenticated/public: it is a RETURNS trigger function (AFTER
--     INSERT on purchase_requests), not an RPC. Postgres does not check
--     EXECUTE when a trigger FIRES (the privilege requirement in the CREATE
--     TRIGGER docs applies to the trigger creator), so the trigger keeps
--     firing for every role; direct PostgREST calls to a RETURNS trigger
--     function were never valid, so the exposed endpoint was dead - the
--     default PUBLIC execute just made it a callable SECURITY DEFINER
--     surface. service_role keeps EXECUTE (trusted admin role, not exposed
--     to clients, not flagged).
-- Idempotent: CREATE OR REPLACE + REVOKE.

CREATE OR REPLACE FUNCTION app_procurement.check_date_needed_lead_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app_procurement, public
AS $$
BEGIN
  IF NEW.date_needed IS NOT NULL AND NEW.date_needed < CURRENT_DATE + 5 THEN
    RAISE EXCEPTION 'Date needed must be at least 5 days from today' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_procurement.set_favorite_item_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app_procurement, auth, public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_procurement.set_pre_approved_item_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app_procurement, auth, public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_procurement_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_procurement, net
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT value INTO v_url FROM app_procurement._config WHERE key = 'supabase_url';
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'supabase_url not found in app_procurement._config';
  END IF;

  -- Fast requester confirmation email (no screenshots).
  PERFORM net.http_post(
    v_url || '/functions/v1/procurement-capture-and-notify',
    jsonb_build_object('request_id', NEW.id, 'event', 'requester_confirmation'),
    '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json'),
    5000
  );

  -- Screenshot capture and approver notification: may take 30s+ for page loads.
  PERFORM net.http_post(
    v_url || '/functions/v1/procurement-capture-and-notify',
    jsonb_build_object('request_id', NEW.id, 'event', 'submitted'),
    '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json'),
    60000
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_procurement_submit() FROM anon, authenticated, public;
