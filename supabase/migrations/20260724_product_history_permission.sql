-- สิทธิ์เข้าหน้า ประวัติผลิต (by Product) — ทุก role ดูได้ (รายงาน read-only) · 2026-07-24
-- หมายเหตุ: สิทธิ์เข้าหน้า (page:/route) เก็บใน role_permissions ตรงๆ (canAccessPage อ่านตัวนี้)
-- permission_catalog เป็นของสิทธิ์ระดับ action (resource+action) — หน้าไม่ต้องลงที่นั่น
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/product-history', true
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
