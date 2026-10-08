-- ── Main project (ewhdfqwfwofivojtsizn — ชื่อในจอ Supabase = "MAIN") ──────────────────
-- หน้าใหม่ /nm-board = 🧭 บอร์ด New Model (IEC) — บอร์ด OBEYA ของงานพาร์ทรุ่นใหม่แบบออนไลน์
-- (ดู docs/IEC-NEW-MODEL-OBEYA-DESIGN.md · ถอดจากบอร์ดผนังของ IEC รุ่น 737D MLM)
--
-- เฟสนี้เป็นหน้า "อ่านอย่างเดียว" ข้อมูลอยู่ในโค้ด (src/data/nmBoard737D.js) ยังไม่ต่อฐานข้อมูล
-- ⇒ ต้องการแค่ page:/nm-board ยังไม่มี resource:action ใหม่
--
-- สิทธิ์ให้เท่ากับ page:/npi ที่มีอยู่แล้ว + engineer_nm (ทีม Engineering New Model)
-- Rollback: delete from role_permissions where permission_key = 'page:/nm-board';

insert into role_permissions (role, permission_key, allowed)
select r.role, 'page:/nm-board', true
  from (select distinct role from role_permissions where permission_key = 'page:/npi' and allowed) r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
values ('engineer_nm', 'page:/nm-board', true)
on conflict (role, permission_key) do nothing;

-- ตรวจหลังรัน:
-- select role, allowed from role_permissions where permission_key = 'page:/nm-board' order by role;
