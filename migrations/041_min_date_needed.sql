-- 041: z8ygbxp4c9 — block "Date Needed" (ETA) dates closer than 5 days out.
-- BEFORE INSERT only: existing rows with old dates must stay orderable,
-- receivable, and return-able (their lifecycle UPDATEs are never checked).
-- Client forms enforce the same rule; this is the server backstop for the
-- public form and direct RPC calls.
-- Idempotent: publish-app re-applies from the last saved version.

CREATE OR REPLACE FUNCTION app_procurement.check_date_needed_lead_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.date_needed IS NOT NULL AND NEW.date_needed < CURRENT_DATE + 5 THEN
    RAISE EXCEPTION 'Date needed must be at least 5 days from today' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_date_needed ON app_procurement.line_items;
CREATE TRIGGER trg_check_date_needed
  BEFORE INSERT ON app_procurement.line_items
  FOR EACH ROW
  EXECUTE FUNCTION app_procurement.check_date_needed_lead_time();
