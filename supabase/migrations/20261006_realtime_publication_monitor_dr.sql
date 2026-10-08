-- Realtime publication: ตารางบอร์ด Monitoring (QC audit 2026-10-06)
-- ★ Apply on DR (ชื่อในจอ Supabase "Product DB") — project eyhclzkifitbhbljgoav
--
-- 🔴 บั๊กเงียบสนิท: `/monitoring` เรียก useLiveBoard(..., { tables: ['monitor_cells','monitor_board_parts'] })
--    แต่ 2 ตารางนี้ **ไม่เคยถูกใส่เข้า publication `supabase_realtime`**
--    ⇒ ไม่มี event เข้ามาเลย ⇒ `makeIdleGate(LIVE.FLOOR)` ที่ฝังใน useLiveBoard ไม่เคยถูก touch
--    ⇒ จอรีเฟรชเฉพาะเมื่อครบ hard floor = **2 ชั่วโมง**
--    = ทีมวางแผนกรอกบอร์ด แล้วเครื่องอื่นเห็นช้าได้ถึง 2 ชม. (คนกรอกเองเห็นเพราะ load() หลังเซฟ)
--    คลาสเดียวกับ rack_requests/inspections ที่ 20260915_realtime_publication_dr.sql ไปแก้
--
-- idempotent — รันซ้ำได้ (เช็คก่อนเพิ่ม)
do $$
declare t text;
begin
  foreach t in array array['monitor_cells', 'monitor_board_parts', 'monitor_boards'] loop
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
--   where pubname='supabase_realtime' and tablename like 'monitor%' order by 1;
-- Rollback:
--   alter publication supabase_realtime drop table public.monitor_cells;
--   alter publication supabase_realtime drop table public.monitor_board_parts;
--   alter publication supabase_realtime drop table public.monitor_boards;
