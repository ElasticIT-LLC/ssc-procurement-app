-- 044: z8ygbxr03d - optional note when marking an ordered item received.
-- Adds a nullable receive_notes column and redefines receive_line_item with
-- an optional p_notes (stored trimmed; NULL when blank). All other behavior
-- is identical to v2 (034): requester/admin/purchaser may receive; received_at
-- stamp; the PO auto-closes once no non-received items remain.
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP/CREATE of the function.
ALTER TABLE app_procurement.line_items ADD COLUMN IF NOT EXISTS receive_notes text;

DROP FUNCTION IF EXISTS app_procurement.receive_line_item(uuid);
CREATE OR REPLACE FUNCTION app_procurement.receive_line_item(p_line_item_id uuid, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
DECLARE v_owner uuid; v_po uuid; v_remaining int;
BEGIN
  SELECT pr.requester_id, li.po_id INTO v_owner, v_po
    FROM app_procurement.line_items li
    JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id
    WHERE li.id = p_line_item_id;
  IF v_owner IS DISTINCT FROM auth.uid()
     AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage')
     AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN
    RAISE EXCEPTION 'Not permitted to mark received';
  END IF;
  UPDATE app_procurement.line_items
     SET status='received', received_at=now(), receive_notes=nullif(trim(coalesce(p_notes,'')), ''), updated_at=now()
    WHERE id=p_line_item_id AND status='ordered';
  IF v_po IS NOT NULL THEN
    SELECT count(*) INTO v_remaining FROM app_procurement.line_items WHERE po_id=v_po AND status <> 'received';
    IF v_remaining = 0 THEN
      UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=v_po AND status='open';
    END IF;
  END IF;
END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.receive_line_item(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.receive_line_item(uuid, text) TO authenticated, service_role;
