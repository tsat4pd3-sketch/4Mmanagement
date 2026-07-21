-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- สิทธิ์หน้า 🗓️ วางแผนการผลิต (/production-plan) — active planner จาก forecast/order + กำลังผลิตจริง
-- seed ให้ role ที่วางแผนการผลิต/ขาย-แผนงาน (แก้เพิ่ม/ลดได้จาก /permissions) · ปลอดภัยต่อการรันซ้ำ
insert into role_permissions (role, permission_key, allowed)
select r.role, 'page:/production-plan',
       r.role in ('admin'::user_role, 'manager'::user_role, 'supervisor'::user_role, 'leader'::user_role,
                  'planner_store'::user_role, 'sale'::user_role)
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;
