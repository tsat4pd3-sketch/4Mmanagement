-- 🏢 แยกสิทธิ์ "แก้ตารางกะหน่วยงานสนับสนุน" ออกจาก "แก้ตารางกะไลน์ผลิต"
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- ที่มา (feedback หน้างาน 2026-08-20): หัวหน้าทีมช่าง (role `mtn`) เปิด /shift-organize ได้
-- (เปิด page ให้แล้วเมื่อ 2026-08-19) ตั้งกะในฐานข้อมูลแล้ว แต่ **ไม่มีปุ่ม ⇄ สลับกะ**
-- เพราะคอลัมน์ "จัดการ" ถูก gate ด้วย `shift_schedule:edit` ซึ่ง seed ไว้แค่ admin/manager/supervisor
-- ตั้งแต่ 20260708 (ก่อน role `mtn` เกิด — กับดัก seed ที่ล็อกรายชื่อ role ไว้ ณ เวลานั้น)
--
-- ทำไมไม่แจก `shift_schedule:edit` ให้ mtn ไปเลย:
--   คีย์นั้นครอบ **ตารางกะไลน์ผลิต + override รายคน + ยุบกะทั้ง section** ด้วย
--   ช่างไม่ควรไปสลับกะไลน์ผลิตของฝ่ายผลิต → แยกคีย์ให้แคบตามงานจริง
--
-- ผลกับคนเดิม: ไม่มีอะไรเปลี่ยน — admin/manager/supervisor ถือ `edit` อยู่แล้ว
-- และโค้ดเช็ค `canEditDept = can(edit) || can(edit_dept)` (edit ครอบ edit_dept เสมอ)
--
-- ⚠️ `dept_admin` เป็น bucket (แอดมินหน่วยงาน) ไม่ใช่ base role — ให้ true ตาม seed default
--    ของ bucket ที่ว่า "ทำได้ทุก action ที่ manager ทำได้" · เป็น action key ไม่ใช่ page:*
--    จึงไม่ปลดล็อกหน้าใหม่ให้ใคร (hasPermission บล็อก page:* ของ bucket ไว้ในโค้ดอยู่แล้ว)

with cat(resource, action, label, group_name, sort, allowed_roles) as (
  values
  ('shift_schedule', 'edit_dept',
   'ตารางกะ: แก้กะหน่วยงานสนับสนุน (ไม่รวมไลน์ผลิต)',
   'พนักงาน & ทักษะ', 432,
   array['admin','manager','supervisor','mtn','dept_admin'])
),
ins_cat as (
  insert into permission_catalog (resource, action, label, group_name, sort)
  select resource, action, label, group_name, sort from cat
  on conflict (resource, action) do nothing
  returning 1
)
insert into role_permissions (role, permission_key, allowed)
select r.role,
       cat.resource || ':' || cat.action,
       (r.role::text = any(cat.allowed_roles))
from cat
cross join (
  select unnest(array[
    'admin','manager','supervisor','leader','qa','document_control',
    'sale','mtn','engineer','planner_store','display','dept_admin'
  ]::user_role[]) as role
) r
on conflict (role, permission_key) do nothing;
