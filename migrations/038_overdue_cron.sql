-- 038: Wave C (C3) — daily 08:00 (DB timezone) overdue-reminder schedule.
-- pg_cron -> net.http_post -> procurement-capture-and-notify, body {"event":"overdue_reminder"}.
-- KEYLESS by decision D1 (CLAUDE.md: never store a service-role JWT in a client-visible vault;
-- msr-overtime-dashboard-app v14 dropped the vault-JWT cron pattern; this function is
-- verify_jwt:false and holds its own service-role key in the edge runtime env).
-- The URL is built from _config.supabase_url (seeded per-environment by publish-app via
-- manifest config[] source=project_url), so this same file works on QA and prod.
-- Idempotent: unschedules any existing job of the same name first.
-- NOTE: uses cron.schedule() rather than a raw INSERT because cron.job is owned by
-- supabase_admin on managed Supabase (postgres lacks INSERT), and cron.schedule()
-- records jobname explicitly (a raw INSERT leaves jobname NULL).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'procurement-overdue-reminders') THEN
    PERFORM cron.unschedule('procurement-overdue-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'procurement-overdue-reminders',
  '0 8 * * *',
  $$SELECT net.http_post(
        url := (SELECT value FROM app_procurement._config WHERE key = 'supabase_url') || '/functions/v1/procurement-capture-and-notify',
        body := '{"event":"overdue_reminder"}'::jsonb,
        headers := '{"Content-Type":"application/json"}'::jsonb
      );$$
);
