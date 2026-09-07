-- 20260907_get_auth_users_admin_guard.sql  ·  ⚠️ Main project (ewhdfqwfwofivojtsizn)
-- full QC audit รอบ 12 — advisor: `get_auth_users()` เป็น SECURITY DEFINER อ่าน auth.users (id/email/created_at)
-- และ **anon เรียกผ่าน /rest/v1/rpc/get_auth_users ได้** (anon key อยู่ในบันเดิลหน้าเว็บ = ใครก็ได้)
-- ⇒ รายชื่ออีเมล login ของทุกบัญชีรั่วโดยไม่ต้อง login · ผู้ใช้เดียวที่ต้องใช้คือหน้า /add-user (admin)
-- แก้: guard admin ในตัวฟังก์ชัน (แบบเดียวกับ set_bot_token) + revoke execute จาก anon/public
-- backward-compatible: AddUser เรียกในฐานะ admin เหมือนเดิม · role อื่นได้ 'forbidden: admin only' (เดิมได้ทั้งลิสต์)
begin;

create or replace function public.get_auth_users()
returns table(id uuid, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = 'auth', 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'forbidden: admin only';
  end if;
  return query select u.id, u.email::text, u.created_at from auth.users u order by u.created_at;
end;
$$;

revoke execute on function public.get_auth_users() from public, anon;
grant  execute on function public.get_auth_users() to authenticated;

commit;

-- เช็คผล: select has_function_privilege('anon','public.get_auth_users()','execute');  -- ต้องเป็น false
-- (สวมบท role อื่นเรียก → ERROR forbidden: admin only · admin → ได้ลิสต์เหมือนเดิม)
