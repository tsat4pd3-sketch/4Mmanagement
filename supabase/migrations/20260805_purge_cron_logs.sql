-- ล้าง log ขยะฝั่ง DR + ตั้ง cron ล้างอัตโนมัติ (2026-08-05)
--
-- ที่มา: ตรวจขนาด DB แล้วพบว่า 43MB จาก 72MB ของ DR project เป็น log ล้วน ไม่ใช่ข้อมูลธุรกิจ
--   • cron.job_run_details — ประวัติการรันของ pg_cron (ตารางตั้งเวลาอยู่ที่ cron.job คนละตัว ไม่กระทบ)
--   • net._http_response — buffer ผลลัพธ์ของ pg_net (โค้ดยิงแบบ fire-and-forget ไม่มีใครอ่านกลับ)
-- ยืนยันก่อนลบ: grep ทั้งโปรเจคแล้วไม่มีโค้ดไหนอ่าน 2 ตารางนี้ · หลังลบ cron ยังวิ่งครบทุก job
--
-- ⚠️ VACUUM FULL รันใน transaction/migration ไม่ได้ — ต้องรันแยกใน SQL Editor หลัง DELETE
--    ถ้าไม่รัน DELETE จะไม่คืนพื้นที่ให้ OS (แค่ mark dead tuple)
--      vacuum full cron.job_run_details;
--      vacuum full net._http_response;
--
-- ROLLBACK: log ที่ลบไปแล้วกู้ไม่ได้ (เป็น log ไม่ใช่ข้อมูลธุรกิจ — ยอมรับได้)
--           ยกเลิกการล้างอัตโนมัติ: select cron.unschedule('purge-cron-logs');

-- 1) ล้างของเก่า เก็บย้อนหลัง 7 วัน
delete from cron.job_run_details where end_time < now() - interval '7 days';
delete from net._http_response  where created  < now() - interval '7 days';

-- 2) ตั้ง cron ล้างทุกวัน 01:00 ไทย (18:00 UTC) — กันโตกลับ (~1MB/วัน)
--    ⚠️ pg_cron ใช้ UTC เสมอ เวลาไทยต้อง −7 ชม.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-cron-logs') then
    perform cron.unschedule('purge-cron-logs');
  end if;
  perform cron.schedule(
    'purge-cron-logs',
    '0 18 * * *',
    $sql$
      delete from cron.job_run_details where end_time < now() - interval '7 days';
      delete from net._http_response  where created  < now() - interval '7 days';
    $sql$
  );
end $$;
