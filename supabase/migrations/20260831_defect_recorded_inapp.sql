-- เปิด "แจ้งในแอป" ให้ defect_recorded (บันทึกของเสีย) — user เคาะ 2026-08-31
--
-- ตอน seed 16 event ใหม่ (20260825_notify_targets_and_silent_events.sql) ตั้ง inapp_roles ว่างไว้ก่อน
-- ตามกฎ "วัดความถี่จริงก่อนเปิด inapp_roles" เพราะยังไม่รู้ว่าของเสียถูกบันทึกถี่แค่ไหน
--
-- วัดแล้ว 21 วัน (defect_logs): 1–7 ครั้ง/วัน · เฉลี่ย ~3 · ไม่มีวันไหนทะลุ 7
--   → ต่ำกว่าเกณฑ์ ~5 ครั้ง/วัน ที่ถือว่ารบกวน (เทียบ shipping_shipped ที่ 338 ครั้งใน 23 นาที)
--   → ของเสียเป็นเรื่องที่หัวหน้าควรรู้ทันที ไม่ใช่ "งานเสร็จแล้ว" ที่รออ่านทีหลังได้
--
-- ⚠️ inapp_match_section = true อยู่แล้ว (seed มาตั้งแต่ต้น)
--   → หัวหน้าได้เฉพาะของเสียใน "ส่วนงานของตัวเอง" ไม่ใช่ทั้งโรงงาน
--   → admin/manager ยังได้ครบทุกส่วนงานตามกติกาของ notify_recipients
--
-- ⚠️ ถ้าวันหน้าการใช้งานโตจนถี่เกินรับไหว ปิดเองได้ที่ /notification-config ไม่ต้องรัน SQL
--
-- ย้อนกลับ: update notification_rules set inapp_roles = '{}'::text[] where event_key = 'defect_recorded';

update public.notification_rules
   set inapp_roles = array['supervisor', 'manager', 'admin', 'qa']::text[]
 where event_key = 'defect_recorded';
