-- 039: Backfill item_on_hold opt-in for users already opted into item_declined.
--
-- The item_on_hold notification key is new in v0.27.0; resolve_notification_recipients
-- defaults new keys to off, so without this backfill existing opted-in users would
-- silently stop receiving hold notifications.
--
-- Only touches users who have item_declined opted in AND do not already have
-- item_on_hold set to true — safe to re-run (idempotent).

update public.user_profiles
set settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{notifications,procurement:item_on_hold}',
  'true'::jsonb
)
where coalesce((settings->'notifications'->>'procurement:item_declined') = 'true', false)
  and coalesce((settings->'notifications'->>'procurement:item_on_hold') = 'true', false) = false;
