-- ── Main project (ewhdfqwfwofivojtsizn) — apply แล้ว 2026-07-13 ──
-- role ใหม่ 'mtn' สำหรับทีมซ่อมบำรุง (MTN / JIG MTN / DIE MTN) — เข้าเกณฑ์เพิ่ม role ได้
-- เพราะชุดสิทธิ์ต่างจาก role เดิมจริง (โฟกัสหน้า PM/ผังเครื่องจักร/ฐานข้อมูลเครื่องจักร
-- ไม่ต้องเห็นหน้าจัดการผลิต) — ดู CLAUDE.md "Role System"
-- ⚠️ ALTER TYPE ADD VALUE ต้องแยก transaction จากการใช้ค่า — ถ้า restore ให้รันทีละท่อน
alter type user_role add value if not exists 'mtn';

-- seed สิทธิ์เริ่มต้น (ปรับรายหน้า/รายการได้ที่หน้า /permissions)
insert into role_permissions (role, permission_key, allowed) values
  ('mtn','page:/',true), ('mtn','page:/dashboard',true),
  ('mtn','page:/pm-check',true), ('mtn','page:/pm-schedule',true),
  ('mtn','page:/mtn-layout',true), ('mtn','page:/pm-setup',true),
  ('mtn','page:/machine-database',true), ('mtn','page:/daily-pm',true),
  ('mtn','page:/report',true),
  ('mtn','pm:record',true), ('mtn','pm:setup',true), ('mtn','pm:approve',true),
  ('mtn','machines:create',true), ('mtn','machines:edit',true), ('mtn','machines:delete',true)
on conflict (role, permission_key) do nothing;
