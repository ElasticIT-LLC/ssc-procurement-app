-- 014: Phase 5 — Purchase Orders. Group approved line items into a PO with an open/closed lifecycle.
-- POs are created/closed via SECURITY DEFINER RPCs (purchasing perm). receive_line_item now auto-closes a PO once its last item is received, and purchasers may mark items received. RLS: purchasers/admins read POs; writes go through the RPCs.

-- Sequence for the numeric part of the human PO number (globally unique; the year in the label is display only).
CREATE SEQUENCE IF NOT EXISTS app_procurement.purchase_order_seq;

CREATE TABLE IF NOT EXISTS app_procurement.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE,
  vendor TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by UUID,
  date_purchased DATE, eta DATE,
  shipping_location_id UUID REFERENCES app_procurement.locations (id), custom_shipping_location TEXT,
  notes TEXT, closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON app_procurement.purchase_orders (status);

ALTER TABLE app_procurement.line_items ADD COLUMN IF NOT EXISTS po_id UUID REFERENCES app_procurement.purchase_orders (id);
CREATE INDEX IF NOT EXISTS line_items_po_idx ON app_procurement.line_items (po_id);

-- RLS: purchasers/admins may read POs (the Purchasing page is permission-gated; requesters don't query POs).
ALTER TABLE app_procurement.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_procurement_purchase_orders_read ON app_procurement.purchase_orders;
CREATE POLICY app_procurement_purchase_orders_read ON app_procurement.purchase_orders FOR SELECT TO authenticated USING (public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') OR public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));

-- create_purchase_order: group approved items into a new open PO, flip them to 'ordered', copy purchase details.
CREATE OR REPLACE FUNCTION app_procurement.create_purchase_order(p_line_item_ids uuid[], p_vendor text, p_date_purchased date, p_eta date, p_shipping_location_id uuid, p_custom_shipping_location text, p_notes text) RETURNS app_procurement.purchase_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_po app_procurement.purchase_orders; v_num text; v_count int; v_req uuid; BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN RAISE EXCEPTION 'Not permitted to purchase'; END IF; IF p_line_item_ids IS NULL OR array_length(p_line_item_ids, 1) IS NULL THEN RAISE EXCEPTION 'No line items provided'; END IF; SELECT count(*) INTO v_count FROM app_procurement.line_items WHERE id = ANY(p_line_item_ids) AND status='approved'; IF v_count <> array_length(p_line_item_ids, 1) THEN RAISE EXCEPTION 'All items must be approved'; END IF; v_num := 'PO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('app_procurement.purchase_order_seq')::text, 4, '0'); INSERT INTO app_procurement.purchase_orders (po_number, vendor, status, created_by, date_purchased, eta, shipping_location_id, custom_shipping_location, notes) VALUES (v_num, nullif(p_vendor,''), 'open', auth.uid(), coalesce(p_date_purchased, current_date), p_eta, p_shipping_location_id, nullif(p_custom_shipping_location,''), nullif(p_notes,'')) RETURNING * INTO v_po; UPDATE app_procurement.line_items SET status='ordered', po_id=v_po.id, date_purchased=coalesce(p_date_purchased, current_date), eta=p_eta, shipping_location_id=p_shipping_location_id, custom_shipping_location=p_custom_shipping_location, purchase_notes=p_notes, updated_at=now() WHERE id = ANY(p_line_item_ids) AND status='approved'; FOR v_req IN SELECT DISTINCT request_id FROM app_procurement.line_items WHERE id = ANY(p_line_item_ids) LOOP PERFORM internal.proc_recompute_request_status(v_req); END LOOP; RETURN v_po; END; $fn$;

-- close_purchase_order: manual close (supports partial/early closure).
CREATE OR REPLACE FUNCTION app_procurement.close_purchase_order(p_po_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ BEGIN IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN RAISE EXCEPTION 'Not permitted to purchase'; END IF; UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=p_po_id AND status='open'; END; $fn$;

-- receive_line_item (REPLACES 002 version): requester/admin/purchaser marks an ordered item received; auto-closes the PO once its last item is received.
CREATE OR REPLACE FUNCTION app_procurement.receive_line_item(p_line_item_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$ DECLARE v_owner uuid; v_po uuid; v_remaining int; BEGIN SELECT pr.requester_id, li.po_id INTO v_owner, v_po FROM app_procurement.line_items li JOIN app_procurement.purchase_requests pr ON pr.id = li.request_id WHERE li.id = p_line_item_id; IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage') THEN RAISE EXCEPTION 'Not permitted to mark received'; END IF; UPDATE app_procurement.line_items SET status='received', updated_at=now() WHERE id=p_line_item_id AND status='ordered'; IF v_po IS NOT NULL THEN SELECT count(*) INTO v_remaining FROM app_procurement.line_items WHERE po_id=v_po AND status <> 'received'; IF v_remaining = 0 THEN UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now() WHERE id=v_po AND status='open'; END IF; END IF; END; $fn$;

REVOKE ALL ON FUNCTION app_procurement.create_purchase_order(uuid[], text, date, date, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.create_purchase_order(uuid[], text, date, date, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app_procurement.close_purchase_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_procurement.close_purchase_order(uuid) TO authenticated, service_role;
