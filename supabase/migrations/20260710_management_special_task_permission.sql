-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- Phase 2 (PERMISSIONS-DESIGN.md): แทน hardcode ['admin','manager','supervisor','leader']
-- ใน Management.jsx (ปุ่มกำหนด/ถอด/มอบหมายงานนอกไลน์) ด้วย can('management','assign_special_task')
-- seed ตรงพฤติกรรมเดิมเป๊ะ — deploy ลำดับ: migration นี้ก่อน แล้วค่อย frontend (fail-closed)

insert into permission_catalog (resource, action, label, group_name, sort)
values ('management', 'assign_special_task', 'กำหนด/ถอดงานนอกไลน์ (5ส ฯลฯ)', 'ฝ่ายผลิต', 15)
on conflict (resource, action) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'management:assign_special_task', true
from unnest(array['admin','manager','supervisor','leader']::user_role[]) as r
on conflict (role, permission_key) do nothing;
