-- ── รันทั้ง 2 project (Main ewhdfqwfwofivojtsizn + DR eyhclzkifitbhbljgoav) ──
-- audit_log retention 6 เดือน (2026-08-19 · คำสั่ง user "ทำเลยนะ ปรับ6เดือน")
--
-- ที่มา: ประเมินว่าจะอยู่ใน Supabase free tier (DB 500MB/project) ได้อีกนานแค่ไหน
--   วัดอัตราโตจริง 30 วันล่าสุด → **audit_log เป็นตัวโตเร็วที่สุด**
--     DR  : 141 แถว/วัน × 1,395 bytes/แถว ≈ 197 KB/วัน = **42% ของการโตทั้ง DR**
--     Main:  81 แถว/วัน × 1,107 bytes/แถว ≈  89 KB/วัน = ~43% ของการโตทั้ง Main
--   แถวใหญ่เพราะเก็บ old_data + new_data เป็น jsonb **ทั้งแถว** ทุกครั้งที่แก้ master
--
--   ไม่ทำ retention : DR เต็มใน ~2.6 ปี
--   เก็บ 6 เดือน    : DR เต็มใน ~4.5 ปี   ← เลือกอันนี้
--   เก็บ 3 เดือน    : DR เต็มใน ~4.7 ปี   (ต่างกันแค่ 0.2 ปี แต่เสียประวัติไปครึ่งหนึ่ง — ไม่คุ้ม)
--
-- ⚠️ ผลที่ต้องยอมรับ: สืบย้อน "ใครแก้ master" ได้แค่ 6 เดือนล่าสุด
--    ถ้าวันหน้าต้องเก็บยาวกว่านี้เพื่อ audit ภายนอก (IATF ฯลฯ) ให้ export ออกก่อนลบ
--    หรือยืด interval — แก้ที่ค่าเดียวใน cron ด้านล่าง
--
-- ⚠️ ไม่กระทบ audit ที่ผูกกับ "เอกสาร/บันทึกคุณภาพ" — พวกนั้นเก็บในตารางของตัวเอง
--    (lpa_audit_answers, ojt_*, four_m_logs, pe_doc_revisions ฯลฯ) ไม่ใช่ audit_log
--    audit_log เก็บเฉพาะการแก้ master data (ทะเบียนเครื่อง/สินค้า/ชนิดปัญหา/สกิล ฯลฯ)

-- 1) ล้างของเก่าทันที (เกิน 6 เดือน)
delete from public.audit_log where changed_at < now() - interval '6 months';

-- 2) ตั้ง job ล้างอัตโนมัติทุกวัน กันโตกลับ
--    เวลา 17:30 UTC = 00:30 ไทย (pg_cron ใช้ UTC เสมอ — เวลาไทย -7 ชม.)
--    เลี่ยงชนกับ purge-cron-logs ที่ 18:00 UTC
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-audit-log') then
    perform cron.unschedule('purge-audit-log');
  end if;
end $$;

select cron.schedule(
  'purge-audit-log',
  '30 17 * * *',
  $$delete from public.audit_log where changed_at < now() - interval '6 months'$$
);

-- rollback: select cron.unschedule('purge-audit-log');
--   (แถวที่ลบไปแล้วกู้ไม่ได้ — เป็นประวัติการแก้ master ไม่ใช่ข้อมูลการผลิต)
