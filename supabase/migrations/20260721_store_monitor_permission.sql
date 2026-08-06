-- สิทธิ์เข้าหน้า เฝ้าระวังสต๊อก & รอบส่ง (Abnormality Monitor) — read-only ทุก role ดูได้ · 2026-07-21
-- TARGET PROJECT: Main (ewhdfqwfwofivojtsizn) — role_permissions อยู่ฝั่ง Main
-- หมายเหตุ: สิทธิ์เข้าหน้า (page:/route) เก็บใน role_permissions ตรงๆ (canAccessPage อ่านตัวนี้)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/store-monitor', true
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
