-- DR (eyhclzkifitbhbljgoav · ชื่อในจอ Supabase "Product DB") · 2026-11-26 · คำสั่ง user
-- "AM ที่ผลิตใช้ บางหัวข้อไม่ได้ตรวจทุกกะทุกวัน แต่ตรวจรายสัปดาห์ หรือเดือนละครั้ง
--  (ต่างกับช่างที่วางแผนเข้ามาตรวจเป็น shutdown maintenance ตามรอบทุกข้อ)"
-- รอบตรวจ "รายหัวข้อ" ของใบ AM — shift (ทุกกะ · ค่าเดิม) / daily / weekly (จ–อา) / monthly
-- 🔴 ใช้เฉพาะใบของทีม AM (isAmTeam) · ใบ PM ของช่างไม่อ่านคอลัมน์นี้ (ตามรอบแผน PM ทั้งใบเหมือนเดิม)
-- กติกาตัดสิน "ข้อไหนถึงรอบ" อยู่ src/utils/amCheckFreq.js ที่เดียว · 📄 docs/modules/pm-hub-check-setup.md §รอบตรวจรายหัวข้อ AM
-- backward-compatible: default 'shift' = ทุกข้อเดิมตรวจทุกกะเหมือนเดิมเป๊ะ
-- ↩️ rollback (ย้อนโค้ดก่อน): alter table public.jig_checkpoints drop column if exists am_check_freq;

alter table public.jig_checkpoints
  add column if not exists am_check_freq text not null default 'shift';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jig_checkpoints_am_check_freq_chk') then
    alter table public.jig_checkpoints add constraint jig_checkpoints_am_check_freq_chk
      check (am_check_freq in ('shift', 'daily', 'weekly', 'monthly'));
  end if;
end $$;

-- ตรวจผล:
-- select am_check_freq, count(*) from public.jig_checkpoints group by 1;
