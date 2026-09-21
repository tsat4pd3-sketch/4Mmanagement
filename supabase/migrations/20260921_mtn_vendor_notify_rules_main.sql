-- ทะเบียนแจ้งเตือน 2 เรื่องของ "ส่งซ่อมภายนอก"  (MAIN · ewhdfqwfwofivojtsizn)
-- 2026-09-21 · คู่กับ 20260921_mtn_outsource_vendor_dr.sql
--
-- ทำไมต้องแจ้ง: user 21/09 — "ต้องเหมือนแจ้งให้ผู้แจ้งทราบด้วย ไม่งั้นจะดองไว้ที่ช่าง
-- ไม่มีใครรู้" ⇒ ทั้งคนเปิดใบ และหัวหน้าส่วนงานที่ไลน์หยุด ต้องเห็นว่าของไปอยู่ข้างนอก
--
-- ยิงผ่าน `notifyEvent()` → edge `send-event-notification` (ตัวส่งกลาง 11 KB)
-- ผู้รับ = RPC `notify_recipients(event, section, team)` จุดเดียวของระบบ
--   + `extra_user_ids` = **ผู้เปิดใบ** (mtn_orders.reported_by_uid) ที่อาจไม่เข้าเกณฑ์ role ใดเลย
-- `inapp_match_section = true` ⇒ ไปเฉพาะหัวหน้าของส่วนงานที่เกิดเหตุ ไม่กวนทั้งโรงงาน
-- ยังไม่ผูกห้อง Telegram (`channel_ids = {}`) ตามคำสั่ง user "ยังไม่ต้องยุ่งเทเลแกรม"
--   → ติ๊กห้องเองได้ทีหลังที่ /notification-config โดยไม่ต้องแก้โค้ด
insert into public.notification_rules
  (event_key, label, category, is_enabled, channel_ids, inapp_roles, inapp_match_section, link, sort_order)
values
  ('mtn_vendor_sent', '📤 ส่งซ่อมภายนอก (รอ supplier)', 'maintenance', true, '{}',
   array['supervisor','leader','mtn']::text[], true, '/mtn-repair', 61),
  ('mtn_vendor_back', '📥 ของกลับจาก supplier แล้ว',     'maintenance', true, '{}',
   array['supervisor','leader','mtn']::text[], true, '/mtn-repair', 62)
on conflict (event_key) do nothing;

-- ตรวจ: select event_key, inapp_roles, inapp_match_section, link
--         from notification_rules where event_key like 'mtn_vendor%';   -- 2 แถว
-- ROLLBACK: delete from public.notification_rules where event_key in ('mtn_vendor_sent','mtn_vendor_back');
