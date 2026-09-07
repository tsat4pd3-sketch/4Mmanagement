-- Main project (ewhdfqwfwofivojtsizn)
-- ⚠️ APPLY แล้วบน DB ตั้งแต่ 2026-09-02 16:19 (schema_migrations version 20260902091909
--   name 'protect_profile_privilege_columns') ผ่าน MCP โดย session อื่น แต่ไม่มีไฟล์ในรีโป
--   ไฟล์นี้ถอดจาก pg_get_functiondef ของ DB จริง (2026-09-07) เพื่อให้รีโปตรงกับ DB — รันซ้ำได้ (idempotent)
--
-- ที่มา: RLS `auth_update_profiles` ของ profiles เป็น using(true)/with check(true) สำหรับ authenticated
--   → บัญชี role ใดก็ได้ (เช่น leader) update แถวโปรไฟล์ของคนอื่นได้ทั้งตาราง
--   เหตุการณ์จริง 2026-09-02 15:49: บัญชี leader ล้าง full_name 49 บัญชี (ทดสอบช่องโหว่ — ดู
--   docs/modules/role-system.md "เหตุการณ์ชื่อผู้ใช้หาย") · ไม่แก้ RLS โดยตรงเพราะ AddUser (admin) ยัง update ผ่าน client
--   → คุมที่ trigger BEFORE UPDATE แทน: ไม่มี JWT (service role/edge/migration) ผ่าน · admin ผ่าน ·
--   คนอื่นแก้ได้เฉพาะแถวตัวเอง และแก้คอลัมน์สิทธิ์/ขอบเขตไม่ได้แม้เป็นแถวตัวเอง

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_admin boolean;
begin
  -- ไม่มี JWT = service role / pg_cron / migration (edge function create-user, delete-user)
  if auth.uid() is null then
    return new;
  end if;

  v_is_admin := current_user_role() is not distinct from 'admin'::user_role;
  if v_is_admin then
    return new;
  end if;

  -- ① แก้โปรไฟล์ของ "คนอื่น" = admin เท่านั้น
  if new.id is distinct from auth.uid() then
    raise exception 'Only admin can edit another user profile';
  end if;

  -- ② คอลัมน์ที่ให้สิทธิ์/ขอบเขต — เจ้าของแถวก็แก้เองไม่ได้
  if new.role is distinct from old.role then
    raise exception 'Only admin can change a user role';
  end if;
  if new.is_dept_admin is distinct from old.is_dept_admin then
    raise exception 'Only admin can change dept-admin flag';
  end if;
  if new.sections is distinct from old.sections then
    raise exception 'Only admin can change section scope';
  end if;
  if new.section is distinct from old.section then
    raise exception 'Only admin can change section';
  end if;
  if new.line_id is distinct from old.line_id then
    raise exception 'Only admin can change line scope';
  end if;
  if new.team is distinct from old.team then
    raise exception 'Only admin can change team';
  end if;
  if new.mtn_teams is distinct from old.mtn_teams then
    raise exception 'Only admin can change maintenance teams';
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'Only admin can link a profile to an employee';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- เช็คผล: select tgname from pg_trigger where tgrelid='public.profiles'::regclass and tgname='trg_protect_profile_role';
