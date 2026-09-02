-- 🔔 ลงทะเบียนเรื่อง "ตัดยอดรอบจัดส่ง — เตรียมของเข้าไลน์"  (Main)
--
-- คู่กับ edge `kanban-round-scan` (DR · cron ทุก 10 นาที) + วิว `v_kanban_round_due`
-- ⚠️ ไม่มีแถวนี้ = `send-event-notification` ตอบ 400 "unknown event" แล้วไม่ส่งอะไรเลย
--
-- ⚠️ `inapp_roles` เว้นว่างโดยตั้งใจ = **Telegram อย่างเดียว ยังไม่เข้ากระดิ่ง/Web Push**
--    กฎ CLAUDE.md: event ที่ยิงเกิน ~5 ครั้ง/วัน ไม่ควรเข้ากระดิ่ง
--    ของจริง: 3 รอบ/วัน × (จำนวนกลุ่มไลน์ที่มีงาน) — ตอนนี้ ~3 ข้อความ/วัน แต่จะโตตาม adoption
--    (ยิงเป็น "ข้อความเดียวรวมทุกไลน์ต่อรอบ" อยู่แล้ว จึงไม่ใช่ 30 ข้อความ)
--    อยากให้เข้าแอปด้วย → ติ๊ก role ที่ /notification-config ได้เลย ไม่ต้องแก้โค้ด
--
-- ห้องปลายทาง: ยืมของ store_abnormal (หมวด logistic ห้องเดียวกัน) — เปลี่ยนเองได้ที่หน้าตั้งค่า

insert into public.notification_rules (event_key, label, category, channel_ids, is_enabled, sort_order, inapp_roles)
select 'kanban_round_cutoff',
       '⏰ ตัดยอดรอบจัดส่ง — เตรียมของเข้าไลน์',
       'logistic',
       coalesce((select channel_ids from public.notification_rules where event_key = 'store_abnormal'), '{}'),
       true,
       84,
       '{}'
where not exists (select 1 from public.notification_rules where event_key = 'kanban_round_cutoff');

-- ตรวจผล:
--   select event_key, label, is_enabled, channel_ids, inapp_roles
--     from notification_rules where event_key = 'kanban_round_cutoff';
