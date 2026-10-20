-- ═══════════════════════════════════════════════════════════════════════════
-- ประวัติการซ่อมรายเครื่อง — ค้นใบ MO ของเครื่องแบบ "ทนการสะกด" (SW10 = SW-10)
-- DR project (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB") · ✅ apply แล้ว 19/10 ผ่าน MCP
-- ใช้ `public.machine_key()` ตัวเดียวกับ `snapMachineNo()` (utils/machineNo.js) — ตรรกะต้องตรงกัน
-- ผู้เรียก: src/components/MachineRepairHistory.jsx · สรุปตัวเลข = src/utils/machineRepairHistory.js
-- read-only · security definer (ตารางนี้ anon-open อยู่แล้ว ไม่ได้เปิดอะไรเพิ่ม)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.mtn_orders_by_machine(p_machine_no text, p_limit int default 300)
returns setof public.mtn_orders
language sql stable security definer set search_path = public as $$
  select * from public.mtn_orders
   where public.machine_key(machine_no) = public.machine_key(p_machine_no)
     and coalesce(p_machine_no, '') <> ''
   order by report_at desc nulls last
   limit least(greatest(coalesce(p_limit, 300), 1), 1000);
$$;
grant execute on function public.mtn_orders_by_machine(text, int) to anon, authenticated;

-- ตรวจ: select count(*) from mtn_orders_by_machine('LS-03');   -- 52 (19/10)
-- ROLLBACK: drop function if exists public.mtn_orders_by_machine(text, int);
