-- Realtime publication: ตารางที่แถบหน้าแรก (/dept-hub) subscribe (QC audit 2026-10-06)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn
--
-- 🔴 คอมเมนต์ใน src/pages/DeptHub.jsx เขียนกลัวอาการนี้ไว้เองแล้ว:
--      "ต้อง subscribe ทั้ง 2 project … ถ้า touch แค่ฝั่งเดียว เลขอีกฝั่งจะค้างถึง LIVE.FLOOR (2 ชม.)
--       เช่นตอนเช้าที่คนเช็คชื่อแล้วแต่ยังไม่มีใครเปิดกะ"
--    แต่ `daily_production_logs` / `four_m_logs` **ไม่เคยอยู่ใน publication ฝั่ง Main**
--    ⇒ channel `depthub-main` ไม่เคยได้ event ⇒ อาการที่กลัวเกิดขึ้นจริงทุกเช้า
--
-- idempotent — รันซ้ำได้
do $$
declare t text;
begin
  foreach t in array array['daily_production_logs', 'four_m_logs'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ตรวจผล:
--   select tablename from pg_publication_tables
--   where pubname='supabase_realtime' and tablename in ('daily_production_logs','four_m_logs');
-- Rollback:
--   alter publication supabase_realtime drop table public.daily_production_logs;
--   alter publication supabase_realtime drop table public.four_m_logs;
