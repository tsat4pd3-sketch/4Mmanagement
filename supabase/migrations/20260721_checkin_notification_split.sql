-- แยกแจ้งเตือนหมวดเช็คชื่อออกเป็น 3 event (Main project ewhdfqwfwofivojtsizn)
--   checkin_summary  : เช็คชื่อเริ่มงาน (ครั้งแรกของวัน) — มีอยู่แล้ว
--   checkin_update   : อัพเดทกำลังคนระหว่างวัน (แก้เข้างาน/ลา/PPE หลังเช็คชื่อไปแล้ว) — ใหม่
--   ot_booking       : จองรถ OT (ใครทำ OT / งานอะไร / กี่โมง) — ใหม่
--
-- เดิมปุ่ม "บันทึก" ตัวเดียวในหน้าเช็คชื่อยิง checkin_summary ทุกครั้ง ไม่ว่าจะเช็คชื่อจริง
-- หรือแค่มาลงจองรถ OT ระหว่างวัน → หัวหน้าแผนกงงว่าทำไมหัวหน้ากลุ่มเช็คชื่อซ้ำตอนบ่าย/เย็น
-- แยก event ให้ข้อความบอกชัดว่าเป็นเรื่องอะไร · ทั้งคู่ default เข้าห้อง 🧑‍🏭 Smart Manpower
-- เหมือน checkin_summary (ปรับห้อง/ปิด/แก้ข้อความได้จากหน้า /notification-config)
-- additive + idempotent — ไม่กระทบ event เดิม

insert into public.notification_rules (event_key, label, category, channel_id, sort_order)
select v.event_key, v.label, v.category,
       coalesce(
         (select channel_id from public.notification_rules where event_key = 'checkin_summary'),
         (select id from public.telegram_channels tc where tc.name = '🧑‍🏭 Smart Manpower')
       ),
       v.ord
from (values
  ('checkin_update', 'อัพเดทกำลังคน (แก้ระหว่างวัน)', 'manpower', 2),
  ('ot_booking',     'จองรถ OT (ใครทำ OT / กี่โมง)',  'manpower', 3)
) as v(event_key, label, category, ord)
on conflict (event_key) do nothing;
