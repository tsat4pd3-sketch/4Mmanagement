-- 🏭 production_lines.is_active — "ปลดระวางไลน์" โดยไม่ต้องลบ  (Main)
--
-- ที่มา (user ทัก 2026-08-21): dropdown กรองไลน์ทุกหน้ามี "test / test child / test child 2"
--   ปนกับไลน์จริง — เป็นไลน์ทดลองที่ยังลบไม่ได้เพราะมีข้อมูลผูกอยู่จริง
--   (shift_schedules 70 แถว · employees 1 · workstations 2)
--
-- ⚠️ ห้ามลบไลน์ทิ้งเพื่อให้ dropdown สะอาด — ชื่อไลน์ถูกเก็บเป็น **text snapshot** ในหลายสิบตาราง
--    ทั้ง 2 project (ดูกฎ rename cascade ใน CLAUDE.md) ลบแล้วข้อมูลเก่ากำพร้าเงียบทันที
--    → ใช้ "ปลดระวาง" แทน: ข้อมูลเก่ายังอ่านออก แต่ไลน์ไม่โผล่ให้เลือกใหม่
--    (pattern เดียวกับ dr_products.is_active / machines.is_active / kanban_standards.is_active)
--
-- backward-compatible: default true → หน้าที่ยังไม่กรอง is_active ทำงานเหมือนเดิมเป๊ะ

alter table public.production_lines
  add column if not exists is_active boolean not null default true;

comment on column public.production_lines.is_active is
  'ไลน์ยังใช้งานอยู่ไหม — false = ปลดระวาง (ไม่โผล่ใน dropdown ให้เลือกใหม่ แต่ข้อมูลเก่ายังอ่านออก) · ตั้งที่ /linesetup';

-- ปลดระวางไลน์ทดลอง (section TEST) — ระบุด้วย section ไม่ใช่ชื่อ เพื่อไม่ผูกกับข้อความ
update public.production_lines
   set is_active = false
 where upper(coalesce(section, '')) = 'TEST'
   and is_active;

-- Rollback:
--   update public.production_lines set is_active = true;
--   alter table public.production_lines drop column if exists is_active;
--   (drop คอลัมน์ต้อง revert โค้ดที่ select is_active ก่อน ไม่งั้น dropdown ไลน์พังทั้งระบบ)
