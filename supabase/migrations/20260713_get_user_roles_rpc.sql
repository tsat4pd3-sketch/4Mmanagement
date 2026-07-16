-- RPC คืนรายชื่อ role ทั้งหมดจาก enum user_role — ให้ Edge Function create-user validate role
-- กับของจริงใน DB (เลิก hardcode รายชื่อ role ใน function — เคยค้าง 5 role ทำให้เลือก sale
-- แล้วโดนสลับเป็น supervisor เงียบๆ) · เพิ่ม role ใหม่ใน enum แล้ว function รองรับเองทันที
create or replace function public.get_user_roles()
returns table (role text)
language sql stable security definer
set search_path = public, pg_temp
as $$ select unnest(enum_range(null::user_role))::text as role $$;
