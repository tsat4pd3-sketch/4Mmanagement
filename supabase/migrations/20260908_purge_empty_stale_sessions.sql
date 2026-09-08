-- 20260908_purge_empty_stale_sessions.sql  ·  ⚠️ DR project "Product DB" (eyhclzkifitbhbljgoav)  ·  รันแล้ว 2026-09-08 (ผ่าน MCP)
-- ล้าง "กะเปล่าค้าง" ตามคำสั่ง user 2026-09-08 — ตรรกะเดียวกับปุ่ม 🗑 ลบกะเปล่า ในแท็บกะค้าง (DailyReport StaleTab)
-- แต่เข้มกว่า: เช็คเพิ่ม line_stock_transactions.ref_session_id / kanban_scans / kanban_targets ด้วย
-- ผลจริง: กะค้าง 56 → ลบ 41 (ไม่มี order/downtime/ของเสีย/สต็อก/kanban เลย) · เหลือ 15 = pending_close มีข้อมูล รอ SV อนุมัติ (ห้ามปิดรวบ)
-- 39/41 = ครอบครัว LINE ASSY TSRA (GWM · MAIN TSRA-1/2 · SUB-STATIONARY) ถูกเปิดจากหน้าเช็คชื่อทุกวัน 1–7 ก.ย. เช้า+ดึก โดยไม่เคยลงอะไร
-- สำรองก่อนลบ: production_sessions_bak_empty_20260908 (RLS เปิด ไม่มี policy = anon อ่านไม่ได้) — กู้คืน: insert into production_sessions select * from production_sessions_bak_empty_20260908;
create table if not exists public.production_sessions_bak_empty_20260908 (like public.production_sessions including all);
alter table public.production_sessions_bak_empty_20260908 enable row level security;

with del as (
  select ps.id from production_sessions ps
  where ps.status in ('open','pending_close') and ps.work_date < work_date_bangkok()
    and not exists (select 1 from prod_orders o where o.session_id=ps.id)
    and not exists (select 1 from downtime_logs d where d.session_id=ps.id)
    and not exists (select 1 from defect_logs f where f.session_id=ps.id)
    and not exists (select 1 from line_stock_transactions t where t.ref_session_id=ps.id)
    and not exists (select 1 from kanban_scans k where k.session_id=ps.id)
    and not exists (select 1 from kanban_targets k where k.session_id=ps.id)
), bak as (
  insert into public.production_sessions_bak_empty_20260908 select ps.* from production_sessions ps where ps.id in (select id from del) returning id
)
delete from production_sessions where id in (select id from bak);
-- เช็คผล: select count(*) from production_sessions where status in ('open','pending_close') and work_date < work_date_bangkok();  -- คาด 15 (pending_close ทั้งหมด)
