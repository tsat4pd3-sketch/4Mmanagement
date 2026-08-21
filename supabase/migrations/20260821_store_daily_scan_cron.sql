-- ⏰ ตั้งเวลาสแกนเฝ้าระวังสโตร์  (DR project)
--
-- ✅ apply แล้ว 2026-08-21 (deploy edge `store-daily-scan` v2 + `send-store-notification` v1 แล้ว)
-- ⚠️ ถ้า rollback: ต้อง unschedule ก่อนลบ edge ไม่งั้น cron ยิงได้ 404 เงียบๆ ทุกวัน
--
-- เวลา: 01:30 UTC = **08:30 น. ไทย** — หลังเริ่มกะเช้า สโตร์เปิดมาเห็นว่าวันนี้ต้องเติมอะไรก่อน
--   (ยิงวันละครั้ง ไม่ใช่ทุก 10 นาที — บทเรียนจาก shipping_phase_alert ที่ยิง 592 ครั้งใน 4 วัน
--    จนกลายเป็นเสียงรบกวนที่ไม่มีใครอ่าน · เปิด/ปิด/เปลี่ยนห้องได้ที่ /notification-config)

select cron.schedule(
  'store-daily-scan',
  '30 1 * * *',
  $$
  select net.http_post(
    url     := 'https://eyhclzkifitbhbljgoav.supabase.co/functions/v1/store-daily-scan',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Rollback:  select cron.unschedule('store-daily-scan');
