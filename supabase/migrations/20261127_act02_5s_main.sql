-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ♻️ กิจกรรม 5S — โครงฐานข้อมูล (2026-11-27 · คำสั่ง user "ยก 5ส ที่สร้างในระบบ Core มาสร้างใน ESM" · loop smf01 · จองใน docs/WORK-CLAIMS.md)
--
-- ชื่อตารางตามรหัสกิจกรรม (คำสั่ง user): act01_ 100P · act02_ 5S · act03_ Smart Factory · … เรียงตามเมนู (utils/activityPages.js)
--   · act_activity = รายชื่อกิจกรรม + รหัส (ใช้ร่วมทุกกิจกรรม) · act_strategy = เอกสารกลยุทธ์ PDF กิจกรรมละ 1 ไฟล์ (ใช้ร่วม)
--   · act02_* = ข้อมูล 5S ทั้งชุด (พื้นที่ · ทีม · หัวข้อตรวจ · แผนตรวจ · ค่าตั้ง · ใบตรวจ · คะแนน · Issue · แผนงาน)
--
-- กติกา (ไม่กระทบของเดิม):
--   · **ตารางเพิ่มอย่างเดียว** ไม่แตะตารางเดิมของ ESM
--   · **คนในทีม 5S เก็บรหัส + ชื่อเอง ไม่มี FK ไป employees** — ทีม 5S มีคนสำนักงาน/Logistic ที่ไม่อยู่ใน employees ของ ESM (28 จาก 62 คน · ตรวจ 27/11)
--     จอจับคู่กับ employees.employee_id_code เมื่อมี (รูป/แผนก) · ไม่มีก็แสดงชื่อที่เก็บไว้
--   · สิทธิ์: อ่านได้ทุกคนที่ login · เขียน = has_perm('act_5s:manage') (admin ผ่านเสมอ · role อื่นเปิดที่ /permissions)
--   · act_strategy เขียน = has_perm('act_5s:manage') ไปก่อน (กิจกรรมอื่นยังไม่มีคีย์ของตัวเอง — เพิ่มเมื่อทำกิจกรรมนั้น)
--   · ไฟล์ PDF กลยุทธ์อยู่ bucket `act-public` (อ่านสาธารณะ · เขียนเฉพาะคนที่ login)
--
-- ตรวจผล:
--   select count(*) from pg_tables where schemaname='public' and (tablename like 'act02\_%' or tablename in ('act_activity','act_strategy'));  -- 11
--   select * from permission_catalog where resource='act_5s';
-- ย้อนกลับ (ไม่มีตารางเดิมอ้าง):
--   drop view if exists public.act02_audit_group;
--   drop table if exists public.act02_task, public.act02_issue, public.act02_audit_score, public.act02_audit, public.act02_setting,
--     public.act02_audit_plan, public.act02_checklist, public.act02_team, public.act02_area, public.act_strategy, public.act_activity cascade;
--   delete from public.role_permissions where permission_key='act_5s:manage'; delete from public.permission_catalog where resource='act_5s';
--   delete from storage.objects where bucket_id='act-public'; delete from storage.buckets where id='act-public';

-- 1) รายชื่อกิจกรรม (ลำดับ = เมนู กิจกรรม)
create table if not exists public.act_activity (
  code        text primary key check (code ~ '^act[0-9]{2}$'),
  menu_key    text not null unique,                 -- key ใน utils/activityPages.js (ACTIVITIES)
  name        text not null,
  sort_order  int  not null unique,
  is_active   boolean not null default true
);
insert into public.act_activity (code, menu_key, name, sort_order) values
  ('act01', '100p', '100P', 1), ('act02', '5s', '5S', 2), ('act03', 'smart', 'Smart Factory', 3),
  ('act04', 'kyt', 'KYT', 4), ('act05', 'kaizen', 'Kaizen', 5), ('act06', 'qcc', 'QCC', 6),
  ('act07', 'lean', 'Lean', 7), ('act08', 'cfo', 'CFO', 8), ('act09', 'cfp', 'CFP', 9)
on conflict (code) do nothing;

-- 2) เอกสารกลยุทธ์ (PDF ≤ 5 หน้า 16:9 · จอตรวจก่อนอัปโหลด)
create table if not exists public.act_strategy (
  activity        text primary key references public.act_activity (code) on update cascade,
  url             text not null check (url ~ '^https://'),
  file_path       text not null,
  file_name       text not null default '',
  pages           int  not null check (pages between 1 and 5),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text
);

-- 3) 5S
create table if not exists public.act02_area (
  act_area      uuid primary key default gen_random_uuid(),
  area_code     text not null unique check (area_code ~ '^[A-Za-z0-9]{1,10}$'),
  area_type     text not null check (area_type in ('factory', 'office')),
  act_area_name text not null check (char_length(act_area_name) between 1 and 120),
  section       text,
  status        text not null default 'Active' check (status in ('Active', 'Inactive')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_by_name text
);

create table if not exists public.act02_team (
  act_team      uuid primary key default gen_random_uuid(),
  year          int  not null check (year between 2000 and 2100),
  employee_code text not null check (employee_code ~ '^[0-9]{7}$'),
  employee_name text,
  role          text not null check (role in ('admin', 'chairman', 'vice', 'standard', 'academic', 'auditor', 'pr', 'owner')),
  team          text check (team is null or team ~ '^[A-I]$'),
  act_area      uuid references public.act02_area (act_area) on update cascade,
  unit          text check (unit is null or unit in ('standard', 'academic', 'pr', 'audit')),
  status        text not null default 'Active' check (status in ('Active', 'Inactive')),
  team_key      text not null unique,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_by_name text,
  check (
    (role = 'owner' and act_area is not null and team is null)
    or (role = 'auditor' and team ~ '^[A-I]$' and act_area is null)
    or (role in ('admin', 'chairman', 'vice', 'standard', 'academic', 'pr') and team is null and act_area is null)
  )
);
create unique index if not exists act02_team_one_owner on public.act02_team (year, act_area) where role = 'owner' and status = 'Active';

create table if not exists public.act02_checklist (
  act_checklist      uuid primary key default gen_random_uuid(),
  year               int  not null check (year between 2000 and 2100),
  item_no            int  not null check (item_no between 1 and 50),
  s_group            text not null check (s_group in ('1S', '2S', '3S', '4S', '5S')),
  act_checklist_name text not null check (char_length(act_checklist_name) between 1 and 200),
  score_max          int  not null default 5 check (score_max between 1 and 5),
  status             text not null default 'Active' check (status in ('Active', 'Inactive')),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  updated_by_name    text,
  unique (year, item_no)
);

create table if not exists public.act02_audit_plan (
  act_audit_plan uuid primary key default gen_random_uuid(),
  year           int  not null check (year between 2000 and 2100),
  act_area       uuid not null references public.act02_area (act_area) on update cascade,
  month          int  not null check (month between 1 and 12),
  week           int  not null check (week between 1 and 4),
  round          int  not null check (round between 1 and 6),
  team           text not null check (team ~ '^[A-I]$'),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_by_name text,
  unique (year, act_area, month, week)
);

create table if not exists public.act02_setting (
  setting_key   text primary key check (char_length(setting_key) between 1 and 80),
  setting_value text not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_by_name text
);
insert into public.act02_setting (setting_key, setting_value) values
  ('pass_percent', '80'), ('pass_percent:2026', '80'), ('pass_self:2026', '85'), ('pass_committee:2026', '80'),
  ('issue_score', '3'), ('issue_due_days_before_next', '15'), ('issue_photo_max', '1'), ('self_audit_due_day', '10')
on conflict (setting_key) do nothing;

create table if not exists public.act02_audit (
  act_audit      uuid primary key default gen_random_uuid(),
  audit_no       text not null unique,
  year           int  not null check (year between 2000 and 2100),
  audit_type     text not null check (audit_type in ('SELF', 'COMMITTEE')),
  act_area       uuid not null references public.act02_area (act_area) on update cascade,
  act_audit_plan uuid references public.act02_audit_plan (act_audit_plan) on update cascade on delete set null,
  team           text check (team is null or team ~ '^[A-I]$'),
  auditors       text[] not null default '{}',
  receivers      text[] not null default '{}',
  audited_at     timestamptz not null,
  total_score    numeric(8, 2) not null default 0,
  percent_score  numeric(5, 2) not null default 0,
  result         text check (result is null or result in ('PASS', 'NEED_IMPROVE')),
  status         text not null default 'COMPLETED' check (status in ('DRAFT', 'COMPLETED')),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_by_name text
);
create index if not exists act02_audit_lookup on public.act02_audit (year, audited_at);

create table if not exists public.act02_audit_score (
  act_audit     uuid not null references public.act02_audit (act_audit) on delete cascade,
  act_checklist uuid not null references public.act02_checklist (act_checklist) on update cascade,
  score         numeric(5, 2) not null check (score >= 0 and score <= 5),
  primary key (act_audit, act_checklist)
);

create table if not exists public.act02_issue (
  act_issue          uuid primary key default gen_random_uuid(),
  issue_no           text not null unique,
  act_audit          uuid not null references public.act02_audit (act_audit) on delete cascade,
  act_area           uuid not null references public.act02_area (act_area) on update cascade,
  act_checklist      uuid not null references public.act02_checklist (act_checklist) on update cascade,
  score              numeric(5, 2) not null check (score >= 0),
  description        text not null,
  photo_before       text[] not null default '{}',
  photo_after        text[] not null default '{}',
  issue_date         date not null,
  responsible_code   text,
  due_date           date,
  action_description text,
  action_date        date,
  status             text not null default 'OPEN' check (status in ('OPEN', 'ON_PLAN', 'WAIT_VERIFY', 'OVERDUE', 'CLOSED')),
  verify_audit_no    text,
  final_score        numeric(5, 2),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  updated_by_name    text
);
create index if not exists act02_issue_area on public.act02_issue (act_area, status);

create table if not exists public.act02_task (
  act_task    uuid primary key default gen_random_uuid(),
  year        int  not null check (year between 2000 and 2100),
  parent_id   uuid references public.act02_task (act_task) on delete cascade,
  sort_no     int  not null default 1,
  title       text not null check (char_length(title) between 1 and 200),
  start_date  date,
  end_date    date,
  progress    int  not null default 0 check (progress between 0 and 100),
  owner_code  text,
  note        text,
  done_on     date,
  unit        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_by_name text,
  constraint act02_task_dates check ((start_date is null) = (end_date is null) and (end_date is null or end_date >= start_date))
);
create index if not exists act02_task_year on public.act02_task (year, parent_id, sort_no);

-- คะแนนต่อหมวด (1S–5S) ของแต่ละใบตรวจ
create or replace view public.act02_audit_group with (security_invoker = true) as
select s.act_audit, c.s_group,
  sum(s.score) as score,
  sum(c.score_max) as score_max,
  round(sum(s.score) * 100.0 / nullif(sum(c.score_max), 0), 2) as percent
from public.act02_audit_score s
join public.act02_checklist c on c.act_checklist = s.act_checklist
group by s.act_audit, c.s_group;

-- 4) สิทธิ์ (คีย์ใหม่ต้องอยู่ใน permission_catalog — ด่าน permissionCatalogCoverage) · nav_groups ยังไม่มีหมวด "กิจกรรม" ⇒ อยู่หมวดคุณภาพ & วิศวกรรม (sort 700–799)
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'act_5s', 'manage', '5S: ตั้งค่า (พื้นที่ · ทีม · หัวข้อตรวจ · แผนตรวจ · เกณฑ์ผ่าน · กลยุทธ์)', 'คุณภาพ & วิศวกรรม', 790
where not exists (select 1 from public.permission_catalog where resource = 'act_5s' and action = 'manage');

-- เปิด RLS ทุกตาราง (เขียนแยกบรรทัดให้ด่าน new-table-needs-rls อ่านเจอ · policy อยู่ข้อ 5)
alter table public.act_activity enable row level security;
alter table public.act_strategy enable row level security;
alter table public.act02_area enable row level security;
alter table public.act02_team enable row level security;
alter table public.act02_checklist enable row level security;
alter table public.act02_audit_plan enable row level security;
alter table public.act02_setting enable row level security;
alter table public.act02_audit enable row level security;
alter table public.act02_audit_score enable row level security;
alter table public.act02_issue enable row level security;
alter table public.act02_task enable row level security;

-- 5) RLS + GRANT + trigger ทุกตาราง (อ่าน = login · เขียน = act_5s:manage) · ไม่มีคำสั่ง drop (MCP ถามยืนยัน) — สร้างเมื่อยังไม่มี
do $$
declare t text;
begin
  foreach t in array array['act_activity', 'act_strategy', 'act02_area', 'act02_team', 'act02_checklist', 'act02_audit_plan',
                           'act02_setting', 'act02_audit', 'act02_audit_score', 'act02_issue', 'act02_task'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_write') then
      execute format('create policy %I on public.%I for all to authenticated using ((select public.has_perm(''act_5s:manage''))) with check ((select public.has_perm(''act_5s:manage'')))', t || '_write', t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'trg_audit') then
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'updated_at')
       and not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'trg_set_updated_at') then
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    end if;
  end loop;
end $$;
grant select on public.act02_audit_group to authenticated;

-- 6) ที่เก็บ PDF กลยุทธ์ (อ่านสาธารณะ · เขียน = act_5s:manage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('act-public', 'act-public', true, 20971520, array['application/pdf'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'act_public_read') then
    create policy act_public_read on storage.objects for select using (bucket_id = 'act-public');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'act_public_write') then
    create policy act_public_write on storage.objects for insert to authenticated with check (bucket_id = 'act-public' and (select public.has_perm('act_5s:manage')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'act_public_update') then
    create policy act_public_update on storage.objects for update to authenticated using (bucket_id = 'act-public' and (select public.has_perm('act_5s:manage')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'act_public_delete') then
    create policy act_public_delete on storage.objects for delete to authenticated using (bucket_id = 'act-public' and (select public.has_perm('act_5s:manage')));
  end if;
end $$;

notify pgrst, 'reload schema';
-- ✅ ลงแล้ว 2026-11-27 ผ่าน MCP (apply_migration act02_5s_main) · ตรวจ: ตาราง 11 · RLS 11 · policy 22 · กิจกรรม 9 · ค่าตั้ง 8 · bucket 1 · สิทธิ์ 1
