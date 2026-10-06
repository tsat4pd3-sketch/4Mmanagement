-- Realtime publication: `line_helpers` (ตกหล่น · ด่านจับได้ตอน merge 2026-10-06)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn
--
-- 🎯 **นี่คือรอบที่ 4 ของบั๊กคลาสเดียวกัน** (19/08 · 15/09 · 06/10 ×2)
--    ต่างกันที่รอบนี้ **ด่านจับได้เองก่อนขึ้น main** — `/manpower-board` subscribe `line_helpers`
--    แต่ตารางไม่อยู่ใน publication ⇒ ถ้าปล่อยไป บอร์ดกำลังคนจะช้าได้ถึง 2 ชม. แบบไม่มี error
--    (ด่าน `realtime-table-registered` ใน regressionGuards · ทะเบียน src/utils/realtimeTables.js)
--
-- idempotent — รันซ้ำได้
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'line_helpers'
  ) then
    alter publication supabase_realtime add table public.line_helpers;
  end if;
end $$;

-- ตรวจผล:
--   select tablename from pg_publication_tables
--   where pubname='supabase_realtime' and tablename='line_helpers';
-- Rollback:
--   alter publication supabase_realtime drop table public.line_helpers;
