-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- 🔔 ปิดช่องว่าง "แจ้งเตือนที่วิ่ง Telegram ทางเดียว" — เตรียมถอด Telegram ตอนย้ายลง on-premise
--    (2026-09-14 · คำสั่ง user: "ถ้าจะย้าย น่าจะไม่เอาระบบแจ้งเตือน telegram"
--     → ต้องมั่นใจก่อนว่าทุกเหตุการณ์ยังส่งถึงคนได้โดยไม่พึ่ง Telegram)
--
-- พบตอนสำรวจ (ดู docs/LOCAL-SERVER-MIGRATION-SPEC.md §13):
--   3 cron function ส่ง Telegram อย่างเดียว ไม่เคยเขียน `notifications` เลย
--   = ถอด Telegram เมื่อไหร่ การแจ้งเตือนพวกนี้หายสนิท ไม่มีกระดิ่ง ไม่มี push
--     · daily-4m-summary   (สรุป 4M ค้างอนุมัติ 08:00)  ← ไม่มี event_key ในทะเบียนด้วยซ้ำ ใช้ห้อง default จาก env
--     · mtn-daily-summary  (สรุปใบซ่อมค้าง 09:00)
--     · qa-fme-scan        (QA เรียกตรวจ / เกินเวลาตรวจ — ทุก 5 นาที)
--   แก้โค้ดทั้ง 3 ตัวให้เขียน `notifications` แล้ว (opt-in ตาม inapp_roles)
--   migration นี้ = ลงทะเบียน event ที่ขาด + เปิดผู้รับในแอปให้ 3 เรื่องนี้
--
-- ⚠️ ตั้งใจเปิดเฉพาะเหตุการณ์ "ปริมาณต่ำ" (สรุปวันละครั้ง / มีเพดาน max_alerts)
--    เหตุการณ์ความถี่สูงยังไม่แตะ — downtime เกิดจริง 145 ครั้ง/วัน (วัด 30 วันย้อนหลัง 2026-09)
--    เปิดในแอปแบบเหมา = กระดิ่ง+push ท่วมทั้ง 87 บัญชี ต้องให้ user เลือกผู้รับก่อน
--    (บทเรียนเดียวกับ 4M Man อัตโนมัติ 392 ใบ/10 วัน จนคนเลิกอ่านคิว)
--
-- ย้อนกลับ (rollback):
--   delete from public.notification_rules where event_key = 'four_m_daily_summary';
--   update public.notification_rules set inapp_roles = '{}'::text[]
--    where event_key in ('mtn_daily_summary','qa_fme_call','qa_fme_overdue');
--   (โค้ด edge function ปลอดภัยอยู่แล้ว — inapp_roles ว่าง = ไม่แจ้งในแอป = พฤติกรรมเดิมเป๊ะ)

-- ── 1) ลงทะเบียน event ที่ยังไม่มีในทะเบียน ───────────────────────────────
--    daily-4m-summary ยิง Telegram ผ่าน env TELEGRAM_CHAT_ID ตรงๆ ไม่เคยผ่าน /notification-config
--    ⇒ admin ปิด/เปลี่ยนห้อง/เลือกผู้รับไม่ได้เลย · ลงทะเบียนแล้วปรับได้จากหน้าเว็บเหมือนเรื่องอื่น
insert into public.notification_rules (event_key, label, category, is_enabled, sort_order, inapp_roles)
values (
  'four_m_daily_summary',
  '📊 สรุป 4M ค้างอนุมัติ ทุกเช้า 08:00',
  'quality',
  true,
  0,
  array['supervisor','manager','qa','admin']::text[]
)
on conflict (event_key) do nothing;

-- ── 2) เปิดผู้รับ "ในแอป" ให้เหตุการณ์ที่เคยมีแต่ Telegram ────────────────
--    เงื่อนไข `array_length(...) = 0` = แตะเฉพาะแถวที่ยังไม่เคยตั้ง
--    (ถ้า admin ตั้งเองไว้แล้ว migration ต้องไม่ทับ — รันซ้ำได้ปลอดภัย)
update public.notification_rules
   set inapp_roles = array['mtn','manager','admin']::text[]
 where event_key = 'mtn_daily_summary'
   and coalesce(array_length(inapp_roles, 1), 0) = 0;

update public.notification_rules
   set inapp_roles = array['qa','admin']::text[]
 where event_key = 'qa_fme_call'
   and coalesce(array_length(inapp_roles, 1), 0) = 0;

-- เกินเวลาตรวจ = escalate → ดึง manager เข้ามาด้วย
update public.notification_rules
   set inapp_roles = array['qa','manager','admin']::text[]
 where event_key = 'qa_fme_overdue'
   and coalesce(array_length(inapp_roles, 1), 0) = 0;
