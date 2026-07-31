-- แจ้งเตือน "ตีกลับใบแจ้งซ่อม (ผิดแผนก)" — Main project (ewhdfqwfwofivojtsizn)
-- ยิงจาก send-mtn-notification event 'mtn_returned' → เข้าห้องรวมให้ผู้แจ้ง/ผลิตเห็นเหตุผล
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order) values
  ('mtn_returned', 'ตีกลับใบแจ้งซ่อม MO (ผิดแผนก → ผู้แจ้งแก้)', 'maintenance', true, '{}', 39)
on conflict (event_key) do nothing;
