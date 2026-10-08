-- ── Main project (MAIN · ewhdfqwfwofivojtsizn) ──
-- 📋 สิทธิ์แผนสั่งงานรายล็อต (แท็บ "แผนสั่งงาน (ล็อต)" ใน /production-plan · 2026-09-30)
--
-- ที่มา: คำสั่ง user — *"หน้าที่เอาไว้ให้หน่วยงานวางแผน จัดแผนการผลิตให้กับฝ่ายผลิต สำหรับพวกงาน
-- lot size ที่ไม่ได้ผลิตตาม KANBAN แบบ first come first serve"*
--
-- 🔑 แยก 2 คีย์ เพราะเป็นคนละคนคนละหน้าที่ (กฎ PERMISSIONS-DESIGN: คีย์ = ปุ่มบนจอ):
--   · `production_plan:write` = **ทีมวางแผน** ออก/แก้/ยกเลิกล็อตในแผน
--   · `production_plan:start` = **หน้างาน** กด "เริ่มล็อตนี้" แล้วระบบสร้างใบผลิตให้
--     ⇒ หัวหน้าไลน์/leader เริ่มงานตามแผนได้ แต่**แก้แผนไม่ได้** · planner แก้แผนได้แต่ไม่ต้องไปกดเริ่มแทน
--
-- ⚠️ ตาราง `production_plan_lots` อยู่ฝั่ง **DR** ซึ่ง client วิ่งด้วย anon เสมอ (ไม่มี JWT)
--    ⇒ RLS ฝั่งนั้นเป็น anon-open ตาม pattern ของ DR ทั้ง project · **สิทธิ์จริงคุมที่ client ด้วย can()**
--    (known gap ของ DR project ที่บันทึกไว้ใน CLAUDE.md — ห้ามไป "แก้ให้ปลอดภัย" ด้วย TO authenticated)
--
-- 🔙 rollback:
--   delete from role_permissions where permission_key in ('production_plan:write','production_plan:start');
--   (ยังไม่ seed = `isActionSeeded` คืน false ⇒ แท็บจะเป็นโหมดอ่านอย่างเดียว ไม่พัง)

insert into role_permissions (role, permission_key, allowed)
select r.role, 'production_plan:write',
       r.role in ('admin'::user_role, 'manager'::user_role, 'dept_admin'::user_role,
                  'planner_store'::user_role, 'supervisor'::user_role)
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;

-- หน้างานกดเริ่มได้กว้างกว่า — leader/supervisor คือคนเดินงานจริงหน้าไลน์
insert into role_permissions (role, permission_key, allowed)
select r.role, 'production_plan:start',
       r.role in ('admin'::user_role, 'manager'::user_role, 'dept_admin'::user_role,
                  'planner_store'::user_role, 'supervisor'::user_role, 'leader'::user_role)
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select permission_key, role, allowed from role_permissions
--  where permission_key like 'production_plan:%' order by permission_key, role;
