-- seed สิทธิ์ของ role ใหม่ 'dept_scope' (สิทธิ์ระดับแผนก) = ชุดเดียวกับ 'supervisor'
--   ชั้นงานเหมือนกัน ต่างแค่ "ขอบเขต" ซึ่งคุมด้วยชั้นสิทธิ์ที่ 3 (writeScope/ccScope) ไม่ใช่ชุดคีย์
--   apply แล้ว 2026-10-21 · ผล: dept_scope 188 คีย์ / allowed 156 = เท่ากับ supervisor เป๊ะ
-- ROLLBACK: update role_permissions set allowed=false where role='dept_scope';  (enum ลบคืนไม่ได้)
insert into public.role_permissions (role, permission_key, allowed)
select 'dept_scope'::public.user_role, rp.permission_key, rp.allowed
from public.role_permissions rp
where rp.role = 'supervisor'::public.user_role
  and not exists (
    select 1 from public.role_permissions x
    where x.role = 'dept_scope'::public.user_role and x.permission_key = rp.permission_key
  );
