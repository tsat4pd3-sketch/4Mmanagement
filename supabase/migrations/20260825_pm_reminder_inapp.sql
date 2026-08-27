-- ══════════════════════════════════════════════════════════════════════════
-- เตือน PM ให้เข้า "กระดิ่งในแอป + Web Push" ด้วย  (2026-08-25 · feedback หน้างาน)
-- Project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา: *"pm ไม่เห็น link กัน · มีเครื่องที่เลยเวลา มีเครื่องที่ต้อง pm อีกไม่กี่วัน
--        ก็ไม่มีอะไรแจ้งเตือน"*
--
-- สาเหตุ: แถว rule ของ PM ถูก seed ตั้งแต่ 2026-07-09 ซึ่ง **ก่อน** คอลัมน์
--         `inapp_roles` จะมี (เพิ่ม 2026-07-31) → ค่าเป็น '{}' = ส่งแต่ Telegram
--         ใครไม่ได้เฝ้าห้องแชทนั้นก็ไม่เห็นอะไรเลย ทั้งที่ระบบยิงออกไปแล้ว
--         (ปัญหาเดียวกับที่หมวด logistic เคยเจอ → 20260821_store_abnormal_notification.sql)
--
-- ⚠️ ความถี่ก่อนเปิดกระดิ่ง (กฎ CLAUDE.md — event เกิน ~5 ครั้ง/วัน ห้ามเข้ากระดิ่ง):
--    PM ยิงเฉพาะตอน "ข้ามขั้น" 30/14/3 วัน + เกินกำหนด (ซ้ำสัปดาห์ละครั้ง)
--    = ระดับไม่กี่ครั้งต่อสัปดาห์ ไม่ใช่ต่อวัน → ปลอดภัยกับกระดิ่ง/Push
--
-- ผู้รับ = ทีมช่าง + วิศวกรรม + หัวหน้า · **ไม่ใส่ role ผลิต** (PM เป็นงานของช่าง
--          ฝ่ายผลิตเห็นผ่านแผนประสานงาน PM อยู่แล้ว) · ปรับเองได้ที่ /notification-config
--
-- รันซ้ำได้ · **แตะเฉพาะแถวที่ยังไม่เคยตั้ง inapp_roles** (ถ้า admin ตั้งเองไว้แล้วไม่ทับ)
-- ══════════════════════════════════════════════════════════════════════════

update public.notification_rules
   set inapp_roles = array['mtn', 'engineer', 'manager', 'admin']::user_role[]
 where event_key in ('pm_plan_reminder', 'pm_deferred')
   and coalesce(array_length(inapp_roles, 1), 0) = 0;

-- ปิดกลับ (ให้เหลือแต่ Telegram เหมือนเดิม):
--   update public.notification_rules set inapp_roles = '{}'
--    where event_key in ('pm_plan_reminder', 'pm_deferred');

-- ── ตรวจผล ──
-- select event_key, label, is_enabled, inapp_roles,
--        coalesce(array_length(channel_ids, 1), 0) as rooms
--   from public.notification_rules
--  where category = 'maintenance'
--  order by sort_order;
