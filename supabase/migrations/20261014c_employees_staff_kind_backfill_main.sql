-- 👥 Backfill employees.staff_kind — แยก "ช่าง" และ "สายสนับสนุน" ออกจากพนักงานหน้างาน
-- Main project "MAIN" (ewhdfqwfwofivojtsizn) · 2026-10-14 · user สั่ง "เอาทั้ง 50 คนเลย"
--
-- ที่มาของการจัดกลุ่ม: `employees.position` เป็น enum ที่กรอกครบแล้ว (audit 14/10)
--   technician                                            → staff_kind = 'technician' (22 คน)
--   clerk · officer · engineer · manager · dept_head · section_head → 'support'       (28 คน)
--   operator · line_leader                                 → คงเดิม 'shopfloor'       (168 คน)
-- 🔴 ขอบเขต = **พนักงานที่ยังทำงานอยู่ (is_active) เท่านั้น** — คนที่ออกไปแล้วไม่ถูกนับที่ไหนอยู่แล้ว
--    และการแตะแถวเก่าโดยไม่จำเป็น = ประวัติ audit รกโดยเปล่าประโยชน์
--
-- ผลที่ตามมา (วัดไว้ใน docs/modules/staff-kind-audit-14-10.md):
--   · ยังเช็คชื่อได้ทุกคน · ยังเปิดดูประวัติ/OT รายบุคคลได้ (จอพวกนั้นเลิกกรองแล้ว 14/10)
--   · หายจาก: /manpower-board · WorkforceInsight แท็บกำลังคน · Report แท็บสกิล — **นี่คือเป้าของงาน**
--   · ไม่กระทบ KPI อัตรามาทำงาน (ObeyaSqdcmBoard คิวรี logs ตรง ไม่ join employees)

-- ── 1) สำรองค่าเดิม — ต้องอยู่ schema `archive` ห้ามไว้ใน public (anon อ่าน public ได้) ──
create schema if not exists archive;

create table if not exists archive.employees_staff_kind_20261014 (
  id              uuid primary key,
  employee_id_code text,
  name            text,
  position        text,
  old_staff_kind  text,
  snapped_at      timestamptz not null default now()
);
revoke all on archive.employees_staff_kind_20261014 from anon, authenticated;

insert into archive.employees_staff_kind_20261014 (id, employee_id_code, name, position, old_staff_kind)
select id, employee_id_code, name, position, staff_kind
from public.employees
where is_active and staff_kind = 'shopfloor'
on conflict (id) do nothing;

-- ── 2) ย้ายกลุ่ม ──
update public.employees
   set staff_kind = 'technician'
 where is_active and staff_kind = 'shopfloor' and position = 'technician';

update public.employees
   set staff_kind = 'support'
 where is_active and staff_kind = 'shopfloor'
   and position in ('clerk', 'officer', 'engineer', 'manager', 'dept_head', 'section_head');

-- ── 3) ย้อนกลับ (ถ้าต้องการ) ──
-- update public.employees e set staff_kind = a.old_staff_kind
--   from archive.employees_staff_kind_20261014 a where a.id = e.id;
