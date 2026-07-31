-- สิทธิ์เข้าหน้า 🔎 สอบกลับ Order (Order Traceability) — ทุก role ดูได้ (รายงาน read-only) · 2026-07-30
-- ข้อมูลในหน้ากรองตาม scope (leader = family ไลน์ตัวเอง · role อื่น = ตาม sections) เหมือน /product-history
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/order-trace', true
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
