-- สิทธิ์เข้าหน้า /process-setup (จุดจัดการ master กระบวนการผลิตในหมวดตั้งค่าฯ) — Main project
-- ตัวจัดการ process_types เดิมอยู่ใน Daily Report ⚙️ (สิทธิ์ทำงาน daily_report:setup) — ยังอยู่ที่เดิมด้วย
-- หน้านี้เป็นทางเข้าเสริมในหมวดตั้งค่าโปรแกรม,ฐานข้อมูล · seed admin/manager/supervisor (เหมือน master อื่น)
-- role อื่นเปิดจาก /permissions ได้ · admin bypass อยู่แล้ว · การ "แก้" ยังคุมด้วย daily_report:setup ใน component
insert into public.role_permissions (role, permission_key, allowed) values
  ('admin','page:/process-setup',true),
  ('manager','page:/process-setup',true),
  ('supervisor','page:/process-setup',true)
on conflict (role, permission_key) do nothing;
