-- 🔴 lot_size ที่ถูกเขียนเป็น "ใบ" ทั้งที่ระบบอ่านเป็น "ชิ้น"  (DR)
--
-- ที่มา (user ถาม 2026-08-21): "lot ใบ คือยังไง ที่จริงมันคือ kanban 1ใบ = pkg 1กล่อง มันคูณกันอยู่ใช่มั้ย"
--   → **ไม่ได้คูณ** · `PlannerSales.jsx doApply` เขียน `kanban_standards.lot_size` ด้วยค่า param
--     "Lot" ของแท็บ Withdrawal ซึ่งเป็น **จำนวนใบ** ลงไปตรงๆ
--   แต่ทุกฝั่งที่อ่านตีความคอลัมน์นี้เป็น **ชิ้น**:
--     fn_explode_child_demand (`while pending >= lot` · pending เป็นชิ้น) · ProductMaster (ป้ายเขียน "ชิ้น")
--     · FlowTower (suggested_lot = 1 กล่อง) · HeijunkaKanban (pending_qty ÷ lot) · VSM · RoutingPanel
--   ⇒ ตั้ง "1 ใบ" (= 1 กล่อง เช่น 100 ชิ้น) กลายเป็น "สะสมครบ 1 ชิ้น ออกใบสั่ง 1 ใบ"
--
--   นี่คือกลไกของเคส 4/8 ที่บันทึกไว้ใน CLAUDE.md ว่า "มีคนตั้ง lot_size = 1" — จริงๆ คน**ไม่ได้พิมพ์ผิด**
--   เขากรอก 1 ใบตามหน่วยที่จอบอก แต่โค้ดลืมคูณ Pkg → ปิดใบผลิตใบเดียวออก purchase_requests 984 ใบ
--
-- แก้ที่ต้นเหตุแล้วใน `lotPcsOf()` (PlannerSales.jsx) — Apply รอบต่อไปเขียนเป็นชิ้นเสมอ
-- ไฟล์นี้ตามเก็บแถวที่ถูกเขียนไปแล้วด้วยหน่วยใบ
--
-- ⚠️ แก้เฉพาะแถวที่ **พิสูจน์ได้** ว่ามาจากปุ่ม Apply (ไม่เดา):
--    มีแถวคู่ใน `kanban_calc_params` · calc_type = 'withdrawal' · และ `params.lot_size = standards.lot_size`
--    (doApply เขียน 2 ตารางนี้ติดกันด้วยค่าเดียวกันเสมอ = ลายนิ้วมือที่ชัด)
--    แถวที่ lot_size < pkg แต่ **ไม่มี param** (11 แถว) → ไม่แตะ อาจเป็น lot-for-lot ที่ตั้งใจตั้งเองจาก Product Master
--    ให้คนตัดสินเอง (ขึ้นเป็น worklist ในหน้า Product Master แท็บ 🎴)
--
-- ผลตอนเขียน: เข้าเกณฑ์ 14 แถว เช่น 20065715 pkg 100 · lot 1 → 100 · 10100333 pkg 35 · lot 15 → 525

create table if not exists public.kanban_lot_bak_units_20260821 as
select mat_no, qty_per_kanban, lot_size, total_kanban, updated_by, updated_at, now() as backed_up_at
from public.kanban_standards where false;

insert into public.kanban_lot_bak_units_20260821
select k.mat_no, k.qty_per_kanban, k.lot_size, k.total_kanban, k.updated_by, k.updated_at, now()
  from public.kanban_standards k
  join public.kanban_calc_params p on p.mat_no = k.mat_no
 where k.is_active
   and k.lot_size is not null and k.qty_per_kanban > 0
   and k.lot_size < k.qty_per_kanban
   and coalesce(p.calc_type, 'withdrawal') = 'withdrawal'
   and p.lot_size = k.lot_size
   and not exists (select 1 from public.kanban_lot_bak_units_20260821 b where b.mat_no = k.mat_no);

update public.kanban_standards k
   set lot_size   = k.lot_size * k.qty_per_kanban,   -- ใบ × ชิ้น/กล่อง = ชิ้น
       updated_by = 'system: แก้หน่วย lot ใบ→ชิ้น (20260821)',
       updated_at = now()
  from public.kanban_calc_params p
 where p.mat_no = k.mat_no
   and k.is_active
   and k.lot_size is not null and k.qty_per_kanban > 0
   and k.lot_size < k.qty_per_kanban
   and coalesce(p.calc_type, 'withdrawal') = 'withdrawal'
   and p.lot_size = k.lot_size;

-- Rollback:
--   update public.kanban_standards k set lot_size = b.lot_size, updated_by = b.updated_by, updated_at = b.updated_at
--     from public.kanban_lot_bak_units_20260821 b where b.mat_no = k.mat_no;
--   (ต้อง revert `lotPcsOf` ใน PlannerSales.jsx ด้วย ไม่งั้น Apply ครั้งถัดไปเขียนเป็นชิ้นอีก)
