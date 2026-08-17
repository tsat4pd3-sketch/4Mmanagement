-- ── DR project (eyhclzkifitbhbljgoav) ──
-- ล้าง log ขยะที่โตเงียบๆ จนกิน DB quota + ตั้ง job ล้างอัตโนมัติ (2026-08-05)
--
-- ที่มา: ตรวจขนาด DB พบ DR ใช้ 72MB จาก quota 500MB แต่ 43MB เป็น log ไม่ใช่ข้อมูลงาน
--   · cron.job_run_details 27MB / 14,188 แถว (สะสมตั้งแต่ 2026-07-08 ไม่เคยลบ)
--     cron ฝั่ง DR รันถี่ (downtime-open-scan ทุก 5 นาที · pm-daily-scan + shipping-phase-scan
--     ทุก 10 นาที) = ~500 แถว/วัน ≈ 1 MB/วัน → ปีละ ~350MB ถ้าปล่อยไว้
--   · net._http_response 16MB แต่มีแถวจริงแค่ 145 = bloat (pg_net ลบแถวเองแต่ไม่คืนพื้นที่)
--
-- ทำไมปลอดภัย (ตรวจก่อนรันแล้ว):
--   · ไม่มีโค้ดแอป/migration ไหนอ่าน 2 ตารางนี้เลย (grep ทั้ง repo)
--   · cron.job_run_details = log ผลการรันเท่านั้น — ตารางตั้งเวลาอยู่คนละตาราง (cron.job)
--     ลบ log ไม่กระทบการทำงานของ cron
--   · net._http_response = buffer ผลตอบกลับ http ของ pg_net · cron ทุกตัวยิงแบบ
--     fire-and-forget (select net.http_post(...) เฉยๆ ไม่มีใคร collect ผล) จึงไม่มีใครรอข้อมูลนี้
--   · ยืนยันหลังรัน: cron 5 job เดิมยัง active + รัน succeeded ตามปกติ · ข้อมูลงานครบเท่าเดิม
--
-- ผล: DB 72MB → 33MB (คืน 39MB)

-- 1) ลบ log เก่ากว่า 7 วัน (เก็บ 7 วันไว้ debug ว่า cron รันครบมั้ย)
delete from cron.job_run_details where start_time < now() - interval '7 days';

-- 2) คืนพื้นที่จริง (DELETE เฉยๆ Postgres ยังไม่คืน ต้อง VACUUM FULL)
--    หมายเหตุ: VACUUM FULL รันใน migration/transaction ไม่ได้ ต้องรันแยกเป็นคำสั่งเดี่ยว
--    ทั้ง 2 ตารางเล็กมาก (แถวจริงหลักพัน) ใช้เวลา <1 วินาที ล็อกสั้นมาก
--      vacuum full cron.job_run_details;
--      vacuum full net._http_response;

-- 3) ตั้ง job ล้างอัตโนมัติทุกวัน กันโตกลับ
--    เวลา: 18:00 UTC = 01:00 ไทย (pg_cron ใช้ UTC เสมอ — เวลาไทยต้อง -7 ชม.)
--    idempotent: ถ้ามี job ชื่อนี้อยู่แล้ว unschedule ก่อนแล้วตั้งใหม่
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-cron-logs') then
    perform cron.unschedule('purge-cron-logs');
  end if;
end $$;

select cron.schedule(
  'purge-cron-logs',
  '0 18 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '7 days'$$
);

-- rollback: select cron.unschedule('purge-cron-logs');
--   (log ที่ลบไปแล้วกู้ไม่ได้ แต่เป็นแค่ประวัติการรัน cron ไม่ใช่ข้อมูลธุรกิจ)
