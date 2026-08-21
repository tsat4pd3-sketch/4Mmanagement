-- 🧹 ยกเลิกใบสั่งซื้อ 984 ใบที่เกิดจาก lot_size=1  (DR)  · apply แล้ว 2026-08-21
--
-- ที่มา: 4/8/2026 มีคนตั้ง kanban_standards.lot_size = 1 ให้ `50031601` (คอยล์ · กล่องละ 100)
--   พอปิดใบผลิต loop ใน fn_explode_child_demand วิ่ง 984 รอบ → ออกใบสั่งซื้อ 984 ใบ ใบละ 1 ชิ้น
--   คิว "ใบสั่งซื้อค้าง" เลยพองเป็น 1,024 ใบ (96% ขยะ) จนคิวจริง 40 ใบถูกกลบมองไม่เห็น
--   ต้นเหตุอุดแล้วที่ `20260821_explode_demand_lot_guard.sql` (เพดาน 50 ใบ/ครั้ง)
--
-- ⚠️ ยกเลิก (cancelled) ไม่ใช่ลบ — เป็นบันทึกคิวงาน ต้องสืบย้อนได้ว่าเคยมีอะไรเกิดขึ้น
--    (precedent เดียวกับการเคลียร์ [Auto] 4M ค้าง 323 ใบ ที่ตั้งเป็น rejected + เหตุผล)
--
-- ผลหลังรัน: pending 1,024 → 40 ใบ (40,000 ชิ้น · mat เดียว) · ordered 2 · cancelled 984

create table if not exists public.purchase_req_bak_lotbug_20260821
  (like public.purchase_requests including all);

insert into public.purchase_req_bak_lotbug_20260821
select * from public.purchase_requests
where status = 'pending' and mat_no = '50031601' and qty = 1
  and created_at::date = '2026-08-04';

update public.purchase_requests
   set status = 'cancelled',
       ordered_by = 'ระบบ (ยกเลิกอัตโนมัติ 21/08/2026)',
       part_name = coalesce(part_name,'') || ' [ยกเลิก: เกิดจาก lot_size=1 ทำให้ระบบออกใบซ้ำ 984 ใบในครั้งเดียว]'
 where id in (select id from public.purchase_req_bak_lotbug_20260821);

-- Rollback:
--   update public.purchase_requests p set status = b.status, ordered_by = b.ordered_by, part_name = b.part_name
--     from public.purchase_req_bak_lotbug_20260821 b where b.id = p.id;
