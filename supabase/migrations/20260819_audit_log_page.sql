-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- หน้า 📜 ประวัติการแก้ไขข้อมูล (/audit-log) — 2026-08-19
--
-- ที่มา (user ทัก): จอดู audit ตัวเดียวของระบบถูกฝังใน /mtn-repair → ⚙️ ข้อมูลตั้งต้น
--   ซึ่งกรองไว้แค่ 9 ตารางของทีมช่าง ทั้งที่มี audit trigger รวม ~74 ตาราง 2 project
--   → ของสำคัญไม่มีหน้าไหนดูได้เลย เช่น
--       Main: role_permissions (309 แถว — ใครแก้สิทธิ์) · profiles (73) · employees (308)
--       DR  : machines (1,494) · jig_checkpoints (1,155) · kanban_standards (350) · dr_products (287)
--   audit เป็นเรื่องระดับ "ประวัติของระบบ" จึงย้ายมาอยู่หมวดตั้งค่าโปรแกรม,ฐานข้อมูล
--   (แท็บเดิมใน /mtn-repair ยังอยู่ — ใช้ component เดียวกัน ไม่ได้ทำ 2 จอให้ drift)
--
-- ⚠️ seed แบบระบุ role ชัด **ห้ามใช้ enum_range** (กับดักที่บันทึกไว้ใน CLAUDE.md:
--    role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้แบบ fail-closed โดยไม่มีใครรู้)
-- ⚠️ ให้เฉพาะ admin/manager เพราะเนื้อหาอ่อนไหว (เห็นการเปลี่ยนสิทธิ์ + ข้อมูลพนักงาน)
--    role อื่นเปิดเพิ่มได้เองที่ /permissions (ลงทะเบียนใน PAGE_GROUPS แล้ว)

insert into role_permissions (role, permission_key, allowed)
select r, 'page:/audit-log', true
from unnest(array['admin','manager']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- rollback:
--   delete from role_permissions where permission_key = 'page:/audit-log';
