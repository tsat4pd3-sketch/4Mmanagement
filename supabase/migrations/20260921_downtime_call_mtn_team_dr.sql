-- ทีมช่างที่ถูกเรียกจากปุ่ม "📞 เรียกช่าง" ใน Daily Report  (DR · eyhclzkifitbhbljgoav)
-- 2026-09-21 · คู่กับ 20260921_notify_recipients_mtn_team.sql (MAIN)
--
-- เดิมปุ่มนี้ไม่เก็บว่าเรียกทีมไหน (และไม่ส่งไปให้ตัวแจ้งเตือนด้วย) ⇒ ช่างทุกทีมโดนเด้ง
-- เก็บเป็น **key** ของทีม (mtn_teams.key) ตามกฎ unify encoding 2026-08-06 ห้ามเก็บชื่อ
-- null = การเรียกก่อนมีฟีเจอร์นี้ (287 แถว) — ไม่ backfill เพราะเดาย้อนหลังไม่ได้ว่าเรียกใครจริง
alter table public.downtime_logs add column if not exists call_mtn_team text;

comment on column public.downtime_logs.call_mtn_team is
  'ทีมช่างที่ถูกเรียก (mtn_teams.key) จากปุ่ม 📞 เรียกช่าง — ส่งต่อเป็น p_team ให้ notify_recipients · null = เรียกก่อน 2026-09-21';

-- ตรวจ: select count(*) from information_schema.columns
--         where table_name='downtime_logs' and column_name='call_mtn_team';   -- 1
-- ROLLBACK: alter table public.downtime_logs drop column if exists call_mtn_team;
