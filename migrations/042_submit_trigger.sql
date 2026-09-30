-- 042: z8ygbxp4cd — canonicalize the request-submit trigger (screenshots +
-- approval email fire automatically on insert).
-- The QA projects carried a manually-created version with a hardcoded
-- project URL + vault anon key; both prod projects had NO trigger, so
-- screenshots/emails only fired on manual "Retry capture". This migration
-- converges all environments on one portable definition:
--   * URL built from _config.supabase_url (per 038's proven pattern)
--   * keyless call (function is verify_jwt=false)
--   * SECURITY DEFINER owned by postgres (matches the working QA version;
--     needed for net.http_post + _config reads)
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.trigger_procurement_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

DROP TRIGGER IF EXISTS trg_procurement_submit ON app_procurement.purchase_requests;
CREATE TRIGGER trg_procurement_submit
  AFTER INSERT ON app_procurement.purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_procurement_submit();
