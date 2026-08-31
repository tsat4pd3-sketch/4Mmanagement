-- 🏢 ตั้งกะหน่วยงานสนับสนุน — ต้องครอบ **ทุกส่วนงาน** ไม่ใช่แค่ MTN (คำสั่ง user 2026-08-20)
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- ไฟล์นี้ครอบคลุมของเดิม `20260820_shift_schedule_edit_dept.sql` ทั้งหมด
-- (สร้างแถวทะเบียนให้ด้วย) → **ยังไม่ได้รันไฟล์แรกก็รันไฟล์นี้ไฟล์เดียวพอ · รันไปแล้วก็รันซ้ำได้**
--
-- ที่มา: รอบแรกเปิดให้เฉพาะ role `mtn` (เพราะ feedback มาจากหัวหน้าทีมช่าง)
--        แต่ทุกหน่วยงานสนับสนุนมีปัญหาเดียวกัน — QA / คลัง-แพลนนิ่ง / วิศวกรรม / เอกสาร
--        ก็มีพนักงานที่ไม่ผูกไลน์ผลิตและต้องตั้งกะเองเหมือนกัน
--
-- กติกาที่ตั้งใจ (ดู ShiftOrganize.jsx):
--   • `shift_schedule:edit`      = แก้ได้ทุกอย่าง (กะไลน์ผลิต + override รายคน + ยุบกะ + หน่วยงาน)
--   • `shift_schedule:edit_dept` = แก้ได้เฉพาะตาราง "หน่วยงานสนับสนุน"
--       └ ถ้าตั้ง `profiles.section` ให้ user ไว้ → แก้ได้เฉพาะหน่วยงานของตัวเอง
--         ไม่ตั้ง = แก้ได้ทุกหน่วยงานที่เห็น (พฤติกรรมเดิม ไม่มีใครเสียสิทธิ์ตอน deploy)
--
-- ⚠️ ทำไมใช้ `profiles.section` (คอลัมน์เดี่ยว) ไม่ใช่ `profiles.sections[]`:
--    `sections[]` เป็น scope ระดับ**ทั้งระบบ** — ตั้งเมื่อไหร่หน้า StoreMonitor / PlannerSales /
--    RundownStock / Dashboard / Report ของคนนั้นเหลือ 0 แถวทันที (กฎเหล็กใน CLAUDE.md)
--    ส่วน `profiles.section` เดี่ยว ไม่กระทบ scope (effectiveSections ข้อ 5) จึงใช้เป็น
--    "หน่วยงานของฉัน" ได้ฟรี — precedent เดียวกับ `employees:edit_all_sections`

-- ── 1) ทะเบียนสิทธิ์ (ให้โผล่ใน /permissions แท็บสิทธิ์การทำงาน) ──────────────
insert into permission_catalog (resource, action, label, group_name, sort)
values ('shift_schedule', 'edit_dept',
        'ตารางกะ: แก้กะหน่วยงานสนับสนุน (ไม่รวมไลน์ผลิต)',
        'พนักงาน & ทักษะ', 432)
on conflict (resource, action) do nothing;

-- ── 2) แถวสิทธิ์ให้ครบทุก role (role ที่ไม่อยู่ในลิสต์ = false ชัดเจน ไม่ปล่อยว่าง) ──
insert into role_permissions (role, permission_key, allowed)
select r.role, 'shift_schedule:edit_dept',
       r.role::text = any(array[
         'admin','manager','supervisor',        -- ถือ edit เต็มอยู่แล้ว (ใส่ไว้ให้ชัด)
         'mtn',                                  -- ช่างซ่อมบำรุง (MTN / JIG MTN / DIE MTN)
         'qa',                                   -- ส่วนประกันคุณภาพ
         'engineer',                             -- ส่วนวิศวกรรม
         'planner_store','sale',                 -- Logistic & Sales (แพลนนิ่ง/คลัง/จัดส่ง)
         'document_control',                     -- งานเอกสาร
         'dept_admin'                            -- bucket แอดมินหน่วยงาน (action key ไม่ใช่ page:*)
       ])
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── 3) เปิดหน้าตารางกะให้ทุกหน่วยงานสนับสนุน ────────────────────────────────
-- `page:/shift-organize` seed ไว้ตั้งแต่ก่อน role พวกนี้เกิด (กับดัก seed รายชื่อ role ตายตัว)
-- → เปิดสิทธิ์ action อย่างเดียวไม่พอ ต้องเข้าหน้าได้ก่อน
-- ⚠️ `do update` เฉพาะ role ที่กำลังเปิดให้ — role อื่นไม่ถูกแตะ (ค่าที่ admin ปรับไว้เองยังอยู่)
insert into role_permissions (role, permission_key, allowed)
select r.role, 'page:/shift-organize', true
from (select unnest(array['mtn','qa','engineer','planner_store','sale','document_control']::user_role[]) as role) r
on conflict (role, permission_key) do update set allowed = true;

-- ตรวจผลหลังรัน:
--   select role, permission_key, allowed from role_permissions
--    where permission_key in ('shift_schedule:edit_dept','shift_schedule:edit','page:/shift-organize')
--    order by permission_key, role;
