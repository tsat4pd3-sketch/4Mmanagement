-- ══ 📺 จอวนหน้า (display rotation) — MAIN · ewhdfqwfwofivojtsizn · ชื่อในจอ Supabase "MAIN" · 2026-10-09 ══
-- คำสั่ง user: "user ที่เป็น role display เราจะตั้งหน้าที่จะให้มันเปิดวนไปเรื่อยๆ ได้มั้ย"
--   → "แบบมีหน้า config ได้ว่าจอ user นี้จะเปิดอะไรวนบ้าง"
--
-- 1 แถว = 1 บัญชีที่ใช้เปิดจอ (user_id = PK) · `items` = ลำดับหน้าที่วน [{ "path": "/tv?dept=production", "sec": 60 }]
--   · sec ว่าง = ใช้ default_sec ของแถว · กฎตีความ/ตรวจค่าอยู่ที่ src/utils/displayRotation.js ที่เดียว
--   · ห้ามเก็บสิทธิ์ไว้ที่นี่ — ตอนวนจริงจอเช็ค canAccessPage() ของบัญชีนั้นทุกหน้า (ไม่มีสิทธิ์ = ข้าม + เขียนบนจอ)
-- อ่าน: เจ้าของบัญชี (จออ่านแผนของตัวเอง) หรือผู้มี `display_rotation:manage`
-- เขียน: `display_rotation:manage` (คีย์เดียวกับปุ่มบันทึกที่ /display-rotation)
--
-- rollback (ไม่กระทบของเดิม — จอแค่หยุดวน):
--   drop table if exists public.display_rotations;
--   delete from role_permissions where permission_key in ('page:/display-rotation','display_rotation:manage');
--   delete from permission_catalog where resource = 'display_rotation';

create table if not exists public.display_rotations (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  enabled         boolean not null default true,
  items           jsonb   not null default '[]'::jsonb,
  default_sec     int     not null default 60,
  pause_sec       int     not null default 120,   -- มีคนแตะจอ = หยุดวนชั่วคราวกี่วินาที
  reload_min      int              default 720,   -- รีโหลดเต็มหน้าทุกกี่นาที (กันหน่วยความจำค้างบนทีวี) · null = ไม่รีโหลด
  note            text,
  updated_by      uuid default auth.uid(),
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint display_rotations_items_array check (jsonb_typeof(items) = 'array'),
  constraint display_rotations_default_sec check (default_sec between 10 and 3600),
  constraint display_rotations_pause_sec   check (pause_sec between 15 and 3600),
  constraint display_rotations_reload_min  check (reload_min is null or reload_min between 60 and 10080)
);

alter table public.display_rotations enable row level security;

drop policy if exists display_rotations_read  on public.display_rotations;
create policy display_rotations_read on public.display_rotations
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_perm('display_rotation:manage')));

drop policy if exists display_rotations_write on public.display_rotations;
create policy display_rotations_write on public.display_rotations
  for all to authenticated
  using      ((select public.has_perm('display_rotation:manage')))
  with check ((select public.has_perm('display_rotation:manage')));

drop trigger if exists trg_display_rotations_updated on public.display_rotations;
create trigger trg_display_rotations_updated before update on public.display_rotations
  for each row execute function public.fn_set_updated_at();

do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.display_rotations;
    create trigger trg_audit after insert or update or delete on public.display_rotations
      for each row execute function public.fn_audit();
  end if;
end $$;

-- สิทธิ์: เปิดวงแคบก่อน (admin bypass อยู่แล้ว + manager) · ขยายได้ที่ /permissions โดยไม่ต้อง deploy
-- ⚠️ ระบุ role ชัด ห้าม enum_range
insert into public.role_permissions (role, permission_key, allowed)
select r, k, true
from unnest(array['admin','manager']::user_role[]) r
cross join unnest(array['page:/display-rotation','display_rotation:manage']) k
on conflict (role, permission_key) do nothing;

insert into public.permission_catalog (resource, action, label, group_name, sort)
values ('display_rotation', 'manage', 'จอวนหน้า: ตั้งว่าบัญชีจอไหนเปิดหน้าอะไรวนบ้าง', 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 918)
on conflict (resource, action) do nothing;

-- ตรวจ:
--   select user_id, enabled, jsonb_array_length(items) n, default_sec, pause_sec, reload_min from display_rotations;
--   select role, permission_key from role_permissions where permission_key like '%display_rotation%' or permission_key = 'page:/display-rotation';
