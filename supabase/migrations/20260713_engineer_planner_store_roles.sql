-- ── Main project (ewhdfqwfwofivojtsizn) — apply แล้ว 2026-07-13 ──
-- role ใหม่ 2 ตัว — เข้าเกณฑ์เพิ่ม role เพราะชุดสิทธิ์ต่างจาก role เดิมจริง (ดู CLAUDE.md "Role System"):
--   engineer      = งานวิศวกรรม (process engineering) — อัพเดท BOM/EC/New Model ใน Product Master
--                   โดยไม่ต้องพ่วงอำนาจจัดการผลิต/พนักงานของ role ระดับจัดการ และไม่ยุ่งอำนาจอนุมัติ QA/งาน PM
--   planner_store = แผนงาน-คลัง (Planner & Store) — Store/Kanban/Rack/Rundown + อัพโหลด Forecast
--                   (แยกจาก sale ซึ่งโฟกัส Delivery/Ship-to Config)
-- ⚠️ ALTER TYPE ADD VALUE ต้องแยก transaction จากการใช้ค่า — ถ้า restore ให้รันทีละท่อน
alter type user_role add value if not exists 'engineer';
alter type user_role add value if not exists 'planner_store';

-- seed สิทธิ์เริ่มต้น (ปรับรายหน้า/รายการได้ที่หน้า /permissions)
insert into role_permissions (role, permission_key, allowed) values
  ('engineer','page:/',true), ('engineer','page:/dashboard',true),
  ('engineer','page:/products',true), ('engineer','page:/report',true),
  ('engineer','page:/machine-database',true),
  ('engineer','products:create',true), ('engineer','products:edit',true)
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed) values
  ('planner_store','page:/',true), ('planner_store','page:/dashboard',true),
  ('planner_store','page:/line-stock',true), ('planner_store','page:/heijunka',true),
  ('planner_store','page:/rack-center',true), ('planner_store','page:/planner-sales',true),
  ('planner_store','page:/rundown-stock',true), ('planner_store','page:/customer-demand',true),
  ('planner_store','page:/products',true), ('planner_store','page:/report',true),
  ('planner_store','heijunka:operate',true),
  ('planner_store','line_stock:issue',true), ('planner_store','line_stock:manage_rounds',true),
  ('planner_store','rack_center:operate',true), ('planner_store','demand:upload',true)
on conflict (role, permission_key) do nothing;
