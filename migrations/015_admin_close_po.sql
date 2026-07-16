-- 015: Allow admins to manually close purchase orders and the purchasing page to show for admins.
-- close_purchase_order RPC now grants both purchasing/manage AND admin/manage.

CREATE OR REPLACE FUNCTION app_procurement.close_purchase_order(p_po_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_procurement, public AS $fn$
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/purchasing/manage')
     AND NOT public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage') THEN
    RAISE EXCEPTION 'Not permitted to close purchase orders';
  END IF;
  UPDATE app_procurement.purchase_orders SET status='closed', closed_at=now(), updated_at=now()
    WHERE id=p_po_id AND status='open';
END;
$fn$;