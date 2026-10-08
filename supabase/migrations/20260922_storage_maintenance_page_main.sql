-- ── Main project (ewhdfqwfwofivojtsizn) — ชื่อในจอ Supabase: "MAIN" ──
-- หน้า 🗜️ ดูแลพื้นที่จัดเก็บ / ค่าเน็ต (/storage-maintenance) — 2026-09-22
--
-- ที่มา (คำสั่ง user): "ที่จริงฟังก์ชันปุ่มบีบอัดรูปน่าจะอยู่ที่ setting"
--   ปุ่ม 🗜️ บีบรูปเดิมแขวนอยู่ที่ /linesetup ซึ่ง (ก) ไม่อยู่ใน sidebar (ฝังใน /layout-setup)
--   (ข) ชื่อหน้าบอกว่าเป็นเรื่องตั้งค่าไลน์ ⇒ หาไม่เจอ (user ต้องถามว่าปุ่มอยู่ไหน)
--   งานนี้กวาดทั้งระบบ 6 กลุ่ม (ผังไลน์ · ผังโรงงาน · ผังเครื่องจักร · รูปจุดตรวจ PM ·
--   รูปซ่อม MO · รูปพนักงาน) ไม่ผูกกับไลน์ใดไลน์หนึ่ง ⇒ ที่ถูกคือหมวดตั้งค่า
--
-- ⚠️ ระบุ role ชัด **ห้ามใช้ enum_range** (role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้เงียบๆ)

-- 1) สิทธิ์เข้าหน้า — ให้คนที่ดูแลข้อมูลหลัก/ระบบ (งานบำรุงรักษา ไม่ใช่งานประจำวันหน้าไลน์)
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/storage-maintenance', true
from unnest(array['admin','manager','engineer','engineer_nm','document_control']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- 2) ทะเบียน action ให้ /permissions เห็น (จอ action อ่านจาก permission_catalog ไม่ใช่ลิสต์ในโค้ด)
insert into permission_catalog (resource, action, label, group_name, sort)
values ('storage_maintain', 'run',
        'ดูแลพื้นที่จัดเก็บ: สั่งบีบรูปที่อัปไว้แล้ว (WebP)',
        'ตั้งค่าโปรแกรม,ฐานข้อมูล', 917)
on conflict (resource, action) do nothing;

-- 3) สิทธิ์กดปุ่ม — ยกมาจากผู้ถือ `line_setup:edit` เดิมให้ "ผลลัพธ์เหมือนเดิมเป๊ะ" วันที่ apply
--    (โค้ดหน้าเว็บ fallback ไป line_setup:edit อยู่แล้วถ้าคีย์นี้ยังไม่ seed — ดู isActionSeeded)
insert into role_permissions (role, permission_key, allowed)
select role, 'storage_maintain:run', allowed
from role_permissions where permission_key = 'line_setup:edit'
on conflict (role, permission_key) do nothing;

-- rollback (ย้อนได้ ไม่กระทบของเดิม — โค้ดจะกลับไปใช้ line_setup:edit เอง):
--   delete from role_permissions where permission_key in ('page:/storage-maintenance','storage_maintain:run');
--   delete from permission_catalog where resource = 'storage_maintain' and action = 'run';
