-- สิทธิ์เข้าหน้า ประวัติผลิต (by Product) — ทุก role ดูได้ (รายงาน read-only) · 2026-07-24
insert into public.permission_catalog (permission_key, label, category, sort_order)
values ('page:/product-history', 'ประวัติผลิต (by Product)', 'วิเคราะห์ & รายงาน', 90)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/product-history', true
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
