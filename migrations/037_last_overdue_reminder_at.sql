-- 037: Wave C (C3) — dedupe column for the 14-day overdue reminder.
-- A pending request re-fires the reminder only when this stamp is older than 14 days.
ALTER TABLE app_procurement.purchase_requests ADD COLUMN IF NOT EXISTS last_overdue_reminder_at timestamptz;
