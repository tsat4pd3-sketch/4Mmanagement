-- เกษียณ legacy `manage_master_data` → แตกเป็นสิทธิ์ย่อย resource:action (2026-07-22)
-- Phase 2 (docs/PERMISSIONS-DESIGN.md) — 3 จุดสุดท้ายที่ยังใช้สวิตช์รวมเดิม:
--   1. OEE Analytics ปุ่ม 🎯 ตั้งเป้า A/P/Q            → oee:set_target
--   2. Report แผงจัดการ master จองรถ OT (สายรถ/งาน OT) → ot_master:manage
--   3. Management ลากจัดกำลังคนบนผัง (+ special panel)  → management:assign_manpower
-- seed default = admin/manager/supervisor (เท่ากับ default เดิมของ manage_master_data เป๊ะ → พฤติกรรมไม่เปลี่ยน)
-- แถว manage_master_data เดิมใน role_permissions คงไว้ (ไม่มีโค้ดอ่านแล้ว) เผื่อ rollback โค้ด
-- เขียนแบบ constraint-agnostic (delete+insert / where not exists) idempotent รันซ้ำได้

-- 1) catalog (โผล่ในตารางจัดการสิทธิ์ แท็บ "สิทธิ์การทำงาน")
delete from public.permission_catalog
  where (resource, action) in (('management','assign_manpower'), ('oee','set_target'), ('ot_master','manage'));
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('management', 'assign_manpower', 'จัดกำลังคนบนผัง (ลากย้ายจุดงาน)',       'ฝ่ายผลิต',      14),
  ('oee',        'set_target',      'OEE: ตั้งเป้า A/P/Q (target รายกรุ๊ป)',  'ฝ่ายผลิต',      16),
  ('ot_master',  'manage',          'จองรถ OT: จัดการ master (สายรถ/งาน OT)', 'รายงาน/คุณภาพ', 52);

-- 2) seed สิทธิ์ = admin/manager/supervisor (เท่ากับ manage_master_data เดิม)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, k.key, true
from (values ('admin'::user_role), ('manager'::user_role), ('supervisor'::user_role)) as r(role)
cross join (values ('management:assign_manpower'), ('oee:set_target'), ('ot_master:manage')) as k(key)
where not exists (
  select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = k.key);
