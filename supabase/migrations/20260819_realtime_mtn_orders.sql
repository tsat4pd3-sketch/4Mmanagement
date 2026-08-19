-- ── DR project (eyhclzkifitbhbljgoav) ──
-- เพิ่ม mtn_orders เข้า realtime publication (2026-08-19)
--
-- ที่มา: ผังรวมโรงงาน (/factory-map) เพิ่ม realtime channel เพื่อลด egress
--        (เดิม poll ทุก 30 วิ ตลอด 24 ชม. → ~13 GB/เดือน/จอ จากโควต้า free 5 GB)
--        metric "🔗 Supply Route" ต้องรู้ทันทีว่าเครื่อง utility มีใบซ่อมเปิดค้าง
--        แต่ `mtn_orders` ไม่เคยอยู่ใน publication → subscription จะ**เงียบไม่ทำงาน**
--        (ห้ามล้มเหลวเงียบ — ตารางที่ไม่ได้ publish จะไม่โยน error ใดๆ แค่ไม่มี event มา)
--
-- ตารางอื่นที่ผังใช้อยู่ใน publication แล้ว:
--   downtime_logs · prod_orders · defect_logs · production_sessions
--
-- ผลข้างเคียง: น้อยมาก — mtn_orders เขียนไม่บ่อย (ทั้งตาราง 8 แถว ณ วันที่เขียน)
--              และยังไม่มี client อื่น subscribe ตารางนี้

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mtn_orders'
  ) then
    alter publication supabase_realtime add table public.mtn_orders;
  end if;
end $$;
