-- System 3 — routing rule for the Maintenance Planned PM staged reminder.
-- Project: MAIN (ewhdfqwfwofivojtsizn). Adds the 'pm_plan_reminder' event to
-- notification_rules so it shows on the config page and (default) goes to the
-- Smart Maintenance room. Admins can re-point / add rooms from /notification-config.

insert into public.notification_rules (event_key, label, category, channel_id, channel_ids, sort_order)
select 'pm_plan_reminder', 'เตือนรอบ PM (30/14/3 วัน + เกินกำหนด)', 'maintenance',
       tc.id, case when tc.id is null then '{}'::uuid[] else array[tc.id] end, 9
from (select id from public.telegram_channels where name = '🔧 Smart Maintenance' limit 1) tc
on conflict (event_key) do nothing;

-- if no Smart Maintenance room exists, still create the rule (unrouted → fallback)
insert into public.notification_rules (event_key, label, category, channel_ids, sort_order)
select 'pm_plan_reminder', 'เตือนรอบ PM (30/14/3 วัน + เกินกำหนด)', 'maintenance', '{}'::uuid[], 9
where not exists (select 1 from public.notification_rules where event_key = 'pm_plan_reminder');
