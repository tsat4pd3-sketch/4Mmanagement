-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- หน้า 🗄️ แผนที่ฐานข้อมูล (/schema) — 2026-09-22
--
-- ที่มา (คำขอ user): ทีมงานเจอบัคแล้วแจ้งว่า "หน้านี้เพี้ยน" ซึ่งไล่ต่อไม่ได้
--   → เปิดจอให้เห็นเองว่า **หน้านี้ใช้ตารางไหน · ตารางนั้นคีย์อะไร · ผูกกับตารางไหน**
--     แล้วกดปุ่มแจ้งบัคที่มีบริบทติดไปให้เลย (ตาราง/โปรเจค/PK/FK/หน้า)
--
-- ให้ "ทุก role ที่เป็นคนทำงาน" เพราะจอนี้อ่านอย่างเดียว ไม่มีข้อมูลในตารางสักแถว
-- (มีแต่ชื่อตาราง/คอลัมน์/คีย์) และคนที่เจอบัคคือคนหน้างาน ไม่ใช่แค่ admin
--   ยกเว้น
--     • display    = บัญชีจอแขวน ไม่มีคนนั่งใช้ ไม่ต้องมีเมนูเพิ่ม
--     • dept_admin = ไม่ใช่ role จริง เป็น bucket สิทธิ์เสริม (โค้ดบล็อก page:* ของ bucket อยู่แล้ว)
-- ⚠️ ระบุ role ชัด **ห้ามใช้ enum_range** (role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้เงียบๆ)
--    role ใหม่/ที่ไม่อยู่ในลิสต์ เปิดเพิ่มเองได้ที่ /permissions (ลงทะเบียนใน PAGE_GROUPS แล้ว)

insert into role_permissions (role, permission_key, allowed)
select r, 'page:/schema', true
from unnest(array['admin','manager','supervisor','leader','qa','engineer','engineer_nm',
                  'document_control','mtn','sale','planner_store']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- rollback:
--   delete from role_permissions where permission_key = 'page:/schema';
