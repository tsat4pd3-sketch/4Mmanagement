-- ══ OBEYA — แจ้งเตือนเมื่อมีเหตุการณ์ความปลอดภัย (Main · 2026-08-27) ══════════════
-- ต่อจาก 20260827_safety_events_obeya.sql
-- เดิมบันทึกอุบัติเหตุแล้วเงียบสนิท — ไม่มีใครรู้จนกว่าจะเปิดบอร์ด Obeya เอง
-- ใช้ท่อกลาง `notifyEvent()` → edge `send-event-notification` (Telegram + ในแอปจากกติกาแถวเดียวกัน)
--
-- กติกา:
-- - ยิงตอน "บันทึกใหม่" เท่านั้น ห้ามยิงตอนแก้ไข (ไม่งั้นแก้ typo ทีนึงเด้งใหม่ทุกครั้ง)
-- - `inapp_match_section = true` → แจ้งหัวหน้าของส่วนงานที่เกิดเหตุ ไม่ใช่ทั้งโรงงาน
-- - ความถี่: อุบัติเหตุเป็นเหตุการณ์ที่ควรหายาก — เปิดเข้ากระดิ่ง/Push ได้โดยไม่เสี่ยง notification fatigue
--   (ต่างจาก shipping_shipped ที่วัดได้ 338 แจ้งเตือนใน 23 นาที จนต้องปิด in-app)
-- - channel_ids ยืมจากกติกาที่มีอยู่แล้ว เพื่อให้ Telegram ทำงานทันทีโดยไม่ต้องไปตั้งห้องทีละเรื่อง
--   (admin เปลี่ยนห้อง/ปิด/แก้ข้อความได้เองที่ /notification-config)

insert into public.notification_rules
  (event_key, label, category, sort_order, is_enabled, channel_ids, inapp_roles, inapp_match_section)
select
  'safety_event',
  '🛡️ เหตุการณ์ความปลอดภัย (อุบัติเหตุ · near miss)',
  'safety',
  470,
  true,
  coalesce((
    select channel_ids from public.notification_rules
    where channel_ids is not null and array_length(channel_ids, 1) > 0
    order by sort_order limit 1
  ), '{}'),
  array['manager', 'supervisor', 'leader', 'admin']::text[],
  true
where not exists (
  select 1 from public.notification_rules where event_key = 'safety_event'
);
