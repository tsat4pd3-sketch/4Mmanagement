-- ═══ ปิดใช้ของทดสอบที่ค้างในผังองค์กร + ทะเบียน cost center ═══
-- Main project (ewhdfqwfwofivojtsizn) · 2026-10-08 · คำสั่ง user ("ปิดใช้ทั้งชุด")
--
-- ของที่ค้าง (is_active = true ทั้งหมด ⇒ โผล่ใน <OrgScopePicker> ของทุกคน):
--   org_nodes  TEST (section · cc 21404444) → test groupe (department · cc 245455)
--              → test line (line · cc 2140666556 · ref_line_id = 14)
--   cost_centers  2140666556 "test line"
-- ไลน์ผลิต id 14/30/35 (test / test child / test child 2) ปิดไปแล้วก่อนหน้านี้
-- 2 รหัสที่โหนดบนชี้ (21404444 · 245455) ถูกลบจากทะเบียนไปแล้ว 06/10
--
-- ⚠️ **ปิดใช้ ไม่ลบ** (คำสั่ง user) — โหนดผังเป็นทะเบียนที่ปลายทางเก็บ "ชื่อ" เป็น text
--    ลบแล้วแถวที่อ้างชื่อเดิมกลายเป็นกำพร้าเงียบๆ · ปิดใช้ = หายจากตัวเลือก แต่ย้อนได้ทันที
--
-- 🔴 กรณี 29 รหัส cost center ที่ลบ 06/10 — **user ตัดสินแล้วว่า "ไม่กู้ ปล่อยไว้" (08/10)**
--    ห้าม session ถัดไป insert กลับเอง · rate ปี 2026 ของ 29 รหัสนั้นยังอยู่ใน cost_center_rates
--    (ชื่อหน่วยจริงอยู่ใน note) ⇒ วันที่ PD2/PD1 ลงทะเบียนไลน์จริง ให้เพิ่มรหัสเข้าทะเบียนตอนนั้น
--    📄 docs/modules/org-hierarchy.md §"ชื่อว่าง" ≠ "ไม่ได้ใช้"
--
-- rollback:
--   update public.org_nodes set is_active = true where name in ('TEST','test groupe','test line');
--   update public.cost_centers set is_active = true where code = '2140666556';

update public.org_nodes set is_active = false
 where is_active and name in ('TEST', 'test groupe', 'test line');

update public.cost_centers set is_active = false
 where is_active and code = '2140666556';

-- ตรวจผล (ควรได้ 0 ทั้งคู่):
--   select count(*) from public.org_nodes where is_active and name ~* 'test';
--   select count(*) from public.cost_centers where is_active and name ~* 'test';
