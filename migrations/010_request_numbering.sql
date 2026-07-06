-- 010: Phase 4 QA — human-readable request numbers + per-item line numbers.
-- request_number: global sequence, defaulted on insert; backfilled by submission order.
-- line_no: per-request 1..N, assigned by a BEFORE INSERT trigger (avoids editing submit_request).
CREATE SEQUENCE IF NOT EXISTS app_procurement.request_number_seq;
ALTER TABLE app_procurement.purchase_requests ADD COLUMN IF NOT EXISTS request_number bigint;
WITH ordered AS (SELECT id, row_number() OVER (ORDER BY submitted_at, id) AS rn FROM app_procurement.purchase_requests) UPDATE app_procurement.purchase_requests pr SET request_number = o.rn FROM ordered o WHERE pr.id = o.id AND pr.request_number IS NULL;
SELECT setval('app_procurement.request_number_seq', coalesce((SELECT max(request_number) FROM app_procurement.purchase_requests), 0) + 1, false);
ALTER TABLE app_procurement.purchase_requests ALTER COLUMN request_number SET DEFAULT nextval('app_procurement.request_number_seq');
ALTER TABLE app_procurement.line_items ADD COLUMN IF NOT EXISTS line_no int;
WITH ordered AS (SELECT id, row_number() OVER (PARTITION BY request_id ORDER BY created_at, id) AS rn FROM app_procurement.line_items) UPDATE app_procurement.line_items li SET line_no = o.rn FROM ordered o WHERE li.id = o.id AND li.line_no IS NULL;
CREATE OR REPLACE FUNCTION internal.proc_assign_line_no() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ BEGIN IF NEW.line_no IS NULL THEN SELECT coalesce(max(line_no),0)+1 INTO NEW.line_no FROM app_procurement.line_items WHERE request_id = NEW.request_id; END IF; RETURN NEW; END; $fn$;
DROP TRIGGER IF EXISTS trg_assign_line_no ON app_procurement.line_items;
CREATE TRIGGER trg_assign_line_no BEFORE INSERT ON app_procurement.line_items FOR EACH ROW EXECUTE FUNCTION internal.proc_assign_line_no();
