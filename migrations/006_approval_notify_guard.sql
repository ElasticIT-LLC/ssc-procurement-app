-- 006: Phase 2b — approval-summary notification guard.
--
-- The approval emails (purchaser "Approved Procurement Request" + requester
-- "Request Summary") are sent once, automatically, when a request's items are all
-- decided. Decided-by is ALREADY tracked: decide_line_item sets line_items.approved_by
-- + approval_date. This guard prevents the client from firing the summary more than once.
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS approval_notified_at timestamptz;
