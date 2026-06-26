-- 004: Enable RLS on the tables that received CUSTOM policies in migration 002.
--
-- WHY: publish-app's apply_app_rls SKIPS any table that already has policies, so it
-- never enabled RLS on purchase_requests / line_items after migration 002 added their
-- custom row-ownership read policy. Result: the policy sat inert and the tables were
-- effectively open (advisor: "Policy Exists RLS Disabled"). Enable it explicitly.
--
-- SAFE: all writes to these tables go through SECURITY DEFINER RPCs owned by `postgres`
-- (BYPASSRLS), so enabling RLS does not block any workflow mutation; it only makes the
-- SELECT (row-ownership) policy actually enforce. Idempotent (no-op if already enabled).
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;
