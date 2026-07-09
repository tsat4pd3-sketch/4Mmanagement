-- Multi-room notification routing — one event can fan out to several rooms.
-- Project: MAIN (ewhdfqwfwofivojtsizn).
--
-- Before: notification_rules.channel_id (single uuid) → one room per event.
-- After : notification_rules.channel_ids (uuid[])    → any number of rooms.
-- The old channel_id column is kept (not dropped) for backward-compat / rollback;
-- the edge function and admin UI read channel_ids from now on.

alter table public.notification_rules
  add column if not exists channel_ids uuid[] not null default '{}';

-- Seed the array from the existing single room so nothing changes on day one.
update public.notification_rules
   set channel_ids = array[channel_id]
 where channel_id is not null
   and (channel_ids is null or channel_ids = '{}');
