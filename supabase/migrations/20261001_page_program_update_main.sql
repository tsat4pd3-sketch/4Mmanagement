-- ── Main project (ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN") ──
-- หน้า 📦 อัพเดทโปรแกรม (/program-update) — 2026-10-01 · คำสั่ง user
--
-- ที่มา: *"เพิ่มหน้า program update … อัพเดทฟีเจอร์อะไรไปบ้าง แก้อะไรไปบ้างด้วย"*
--   ทีมงานที่แจ้งปัญหาเข้ามาอยากรู้ว่า "ที่แจ้งไปแก้แล้วยัง" · ผู้มาเยี่ยมชม (GM ต่างโรง)
--   อยากรู้ว่าระบบยังมีคนดูแลอยู่จริงไหม
--
-- ให้ **ทุก role ที่เป็นคนทำงาน** เพราะจอนี้:
--   · อ่านอย่างเดียว ไม่แตะ Supabase เลย (ข้อมูลมาจาก public/changelog.json ที่สร้างตอน build)
--   · ไม่มีข้อมูลการผลิต/คน/ราคา สักแถว — มีแต่ข้อความสรุปการแก้ของระบบ
--   ยกเว้น
--     • display    = บัญชีจอแขวน ไม่มีคนนั่งใช้ ไม่ต้องมีเมนูเพิ่ม
--     • dept_admin = ไม่ใช่ role จริง เป็น bucket สิทธิ์เสริม (โค้ดบล็อก page:* ของ bucket อยู่แล้ว)
-- ⚠️ ระบุ role ชัด **ห้ามใช้ enum_range** (role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้เงียบๆ)
--    role ใหม่เปิดเพิ่มเองได้ที่ /permissions (ลงทะเบียนใน PAGE_GROUPS แล้ว)

insert into role_permissions (role, permission_key, allowed)
select r, 'page:/program-update', true
from unnest(array['admin','manager','supervisor','leader','qa','engineer','engineer_nm',
                  'document_control','mtn','sale','planner_store']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- ตรวจผลหลังรัน:
--   select role, allowed from role_permissions where permission_key = 'page:/program-update' order by role;
--   คาดหวัง 11 แถว · allowed = true ทุกแถว

-- rollback:
--   delete from role_permissions where permission_key = 'page:/program-update';
