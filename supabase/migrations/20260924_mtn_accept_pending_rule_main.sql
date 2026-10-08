-- ════════════════════════════════════════════════════════════════════════════════
-- 🧰 แจ้งเตือน "ใบซ่อมที่ยังไม่มีช่างรับ" (ขั้น 2) — event ใหม่ mtn_accept_pending
-- Project: MAIN (ewhdfqwfwofivojtsizn)          วันที่: 2026-09-24
--
-- ที่มา — วัดจริง 24/09 (mtn_orders.status = 'pending' ฝั่ง DR · 25 ใบทั้งระบบ):
--     JIG MTN 23 ใบ · เกิน 7 วัน 17 ใบ · นานสุด 22 วัน · เฉลี่ย 12.3 วัน
--     (maintenance 1 ใบ · production 1 ใบ)
--   ⇒ ใบที่ "ยังไม่มีใครเริ่มเลย" กองอยู่ทีมเดียว ทั้งที่สรุปเช้ายิงทุกวันมาตลอด
--
-- ทำไมของเดิมไม่ช่วย (เหตุผลเต็ม + โค้ด → supabase/functions/mtn-daily-summary/index.ts):
--   1. บล็อกรายทีมในสรุปเช้าไม่มีชั้นอายุ — ใบ 22 วันหน้าตาเหมือนใบเมื่อวาน
--   2. telegram_channels ไม่มีห้องไหนแท็ก team เลยนอกจาก 'production'
--      ⇒ บล็อกรายทีมไม่เคยถูกยิงเลยแม้แต่ครั้งเดียว
--   3. กระดิ่งในแอปของ mtn_daily_summary = บรรทัดเดียวทั้งโรงงาน ไม่บอกทีม ไม่บอกอายุ
--
-- 🔑 inapp_match_section = true + ส่ง "ชื่อทีม" เป็น section
--    ใช้ได้เพราะ profiles.section ของช่างเก็บชื่อทีมไว้จริง (วัด 24/09: section='JIG MTN' 6 คน)
--
-- ⚠️ ตั้ง inapp_roles ให้เลย (ไม่ใช่ opt-in เปล่าแบบ event อื่น) — เจตนาของงานนี้คือ
--    "ให้ถึงตัวช่าง" ถ้า seed เป็น {} ไว้ก่อน แจ้งเตือนจะเงียบจนกว่าจะมีคนไปตั้งเอง
--    = ไม่ได้แก้อะไรเลย · admin ปิด/แก้ผู้รับได้จาก /notification-config ตลอดเวลา
--
-- ROLLBACK:  delete from public.notification_rules where event_key = 'mtn_accept_pending';
--            (แถวเดียว ไม่มีใครอ้างถึง · edge function อ่านไม่เจอ = resolveEvent คืนห้องหลัก
--             และ notifyInApp คืน false = เงียบ ไม่พัง)
-- ════════════════════════════════════════════════════════════════════════════════

insert into public.notification_rules
  (event_key, label, category, sort_order, is_enabled,
   inapp_roles, inapp_match_section, inapp_scope_strict, link)
values
  ('mtn_accept_pending',
   'ใบซ่อมที่ยังไม่มีช่างรับ (ขั้น 2) — สรุปเช้า 09:00',
   'maintenance', 38, true,
   array['mtn','manager']::text[], true, true, '/mtn-repair')
on conflict (event_key) do update set
  label               = excluded.label,
  category            = excluded.category,
  sort_order          = excluded.sort_order,
  link                = excluded.link,
  updated_at          = now();
-- ⚠️ on conflict **ไม่แตะ** is_enabled / inapp_roles / inapp_match_section / channel_ids
--    = ถ้า admin ปรับผู้รับหรือปิด event ไว้แล้ว รัน migration ซ้ำต้องไม่ล้างของเขา
