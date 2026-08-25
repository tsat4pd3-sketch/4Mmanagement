-- ══ สิทธิ์เข้าหน้า 📟 OEE รายไลน์ (จอไลน์) — /line-oee (Main · 2026-08-25) ══
-- บอร์ดจอ TV ประจำไลน์ (โครงตามภาพ OEE SUMMARY WEEKLY ที่ user ส่งมา) — อ่านอย่างเดียว
-- seed แบบ "ระบุ role ชัดเจน" ครบทุก role ปัจจุบัน (ห้าม enum_range — กับดัก role ใหม่ fail-closed)
-- role display สำคัญสุด (จอ TV login ด้วยบัญชี display)
insert into public.role_permissions (role, permission_key, allowed)
select v.r::user_role, 'page:/line-oee', true
from (values
  ('admin'), ('manager'), ('supervisor'), ('leader'), ('qa'), ('document_control'),
  ('sale'), ('mtn'), ('engineer'), ('planner_store'), ('display')
) v(r)
where not exists (
  select 1 from public.role_permissions
  where role = v.r::user_role and permission_key = 'page:/line-oee'
);
