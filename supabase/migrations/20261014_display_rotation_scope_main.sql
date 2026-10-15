-- ══ 🔁 จอวนหน้า: แอดมินส่วนงานตั้งได้เฉพาะจอของส่วนงานตัวเอง — MAIN · ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN" · 2026-10-14 ══
-- คำสั่ง user: "user admin ระบบของแต่ละส่วนงาน สามารถ setup จอของส่วนงานตัวเองได้ ห้าม setup ข้ามกันมั่ว"
--
-- (1) fn_can_manage_display(target) — ตรรกะต้องตรงกับ canManageDisplay() ใน src/utils/displayRotation.js
--     · ผู้ตั้งทั้งโรงงาน (admin / scope_depth='all' / ไม่มีส่วนงานให้ยึด = เท่ากับ effectiveSections() ที่คืน [])
--       = ได้ทุกจอ
--     · จอต้องเป็น role display เท่านั้น (หน้าตั้งค่าไม่โชว์บัญชีอื่นแล้ว — ด่านนี้กันยิงตรง)
--     · จอที่ไม่ได้ตั้งส่วนงาน (เห็นทั้งโรงงาน) = เฉพาะผู้ตั้งทั้งโรงงาน
--     · จอหลายส่วนงาน = ผู้ตั้งต้องครอบทุกส่วนงานของจอ
-- (2) policy เขียนเดิม has_perm('display_rotation:manage') → + fn_can_manage_display(user_id)
-- (3) bucket แอดมินหน่วยงาน (dept_admin) ได้ display_rotation:manage
--     (หน้า /display-rotation piggyback คีย์นี้ใน canAccessPage — ไม่ต้องแจก page:* ให้ทุก supervisor)
--
-- พฤติกรรมวันที่ apply: admin/manager เดิม (ไม่จำกัดส่วนงาน) เขียนได้เท่าเดิม · ยังไม่มีแถวในตารางที่ไม่ใช่ display
--
-- rollback:
--   drop policy if exists display_rotations_write on public.display_rotations;
--   create policy display_rotations_write on public.display_rotations for all to authenticated
--     using ((select public.has_perm('display_rotation:manage'))) with check ((select public.has_perm('display_rotation:manage')));
--   delete from role_permissions where role='dept_admin' and permission_key='display_rotation:manage';
--   drop function if exists public.fn_can_manage_display(uuid);

create or replace function public.fn_can_manage_display(p_target uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  me profiles%rowtype;
  tg profiles%rowtype;
  my_secs text[];
  tg_secs text[];
begin
  select * into me from profiles where id = auth.uid();
  if not found then return false; end if;
  select * into tg from profiles where id = p_target;
  if not found or tg.role <> 'display'::user_role then return false; end if;
  if me.role = 'admin'::user_role or me.scope_depth = 'all' then return true; end if;

  my_secs := array(select lower(trim(s)) from unnest(coalesce(me.sections, '{}')) s where nullif(trim(s), '') is not null);
  if cardinality(my_secs) = 0 and nullif(trim(me.section), '') is not null then my_secs := array[lower(trim(me.section))]; end if;
  if cardinality(my_secs) = 0 then return true; end if;   -- เท่า effectiveSections() = [] (ไม่จำกัด)

  tg_secs := array(select lower(trim(s)) from unnest(coalesce(tg.sections, '{}')) s where nullif(trim(s), '') is not null);
  if cardinality(tg_secs) = 0 and nullif(trim(tg.section), '') is not null then tg_secs := array[lower(trim(tg.section))]; end if;
  if cardinality(tg_secs) = 0 then return false; end if;

  return tg_secs <@ my_secs;
end $$;
revoke execute on function public.fn_can_manage_display(uuid) from public, anon;
grant  execute on function public.fn_can_manage_display(uuid) to authenticated;

drop policy if exists display_rotations_write on public.display_rotations;
create policy display_rotations_write on public.display_rotations
  for all to authenticated
  using      ((select public.has_perm('display_rotation:manage')) and public.fn_can_manage_display(user_id))
  with check ((select public.has_perm('display_rotation:manage')) and public.fn_can_manage_display(user_id));

insert into public.role_permissions (role, permission_key, allowed)
values ('dept_admin'::user_role, 'display_rotation:manage', true)
on conflict (role, permission_key) do nothing;

-- ตรวจ:
--   select policyname, qual from pg_policies where tablename = 'display_rotations';
--   select role, permission_key, allowed from role_permissions where permission_key = 'display_rotation:manage';
