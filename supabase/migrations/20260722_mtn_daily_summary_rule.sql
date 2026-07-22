-- สรุปงานซ่อม (MO) ค้างประจำวัน — Main project (ewhdfqwfwofivojtsizn)
-- edge function `mtn-daily-summary` ยิงทุกเช้า 09:00 ไทย รวมใบที่ยังไม่ปิด นับตามทีม+ขั้นที่ค้าง
-- category 'maintenance' · channel_ids ว่าง = เข้ากลุ่ม default (fallback / smart maintenance)
--   จนกว่าจะเลือกห้องจาก /notification-config · แยกรายทีมเข้าห้องที่แท็ก team ไว้อัตโนมัติ
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order) values
  ('mtn_daily_summary', 'สรุปงานซ่อมค้าง MO ทุกเช้า 09:00', 'maintenance', true, '{}', 37)
on conflict (event_key) do nothing;
