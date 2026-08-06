-- แจ้งเตือน "เลื่อนแผน PM" — Main project (ewhdfqwfwofivojtsizn)
-- ยิงจากหน้า PMSchedule ตอนบันทึกการเลื่อน → send-notification event 'pm_deferred'
-- category maintenance · channel_ids ว่าง = ห้อง default (fallback) จนกว่าจะเลือกห้องที่ /notification-config
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order) values
  ('pm_deferred', 'เลื่อนแผน PM (ตกลงกับ planner/production)', 'maintenance', true, '{}', 38)
on conflict (event_key) do nothing;
