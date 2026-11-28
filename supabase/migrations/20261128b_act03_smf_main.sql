-- ══ 🏭 กิจกรรม Smart Factory (act03) — ยกจากเว็บ TSAT4 Activity (SMF) · 2026-11-28 · loop smf01 ══════════════════
-- project: MAIN (ewhdfqwfwofivojtsizn) · คำสั่ง user 28/11 "ไปก็อปงาน TSAT4 Activity มาใส่ · SMF คือ Smart Factory"
--   · act03_project      = โครงการรายปี (Smart OEE · Vision Camera · Work Flow Automation …) · เป้าแบบตามแผน (plan) หรือนับจำนวน (count)
--   · act03_team         = ทีมรายปี: คณะกรรมการ (unit ว่าง: ประธาน · รองประธาน · ที่ปรึกษา · ผู้ประสานงาน · สมาชิกหลัก)
--                          + ทีมย่อยของแต่ละโครงการ (unit = รหัสโครงการ: หัวหน้าทีม · รองหัวหน้าทีม · ทีม SMF)
--   · act03_task         = แผนงานรายปี 2 ชั้น (ข้อหลัก/ข้อย่อย) ผูกโครงการด้วย unit
--   · act03_project_month = เป้า/ผลงานรายเดือนของโครงการ (Edit Data รอบถัดไป)
--   · act03_idea / _image / _eval = Work Flow Automation (ข้อเสนอ 6 ขั้น · รูป Before/After · ผลประเมิน) — ตารางรอไว้ รอบถัดไป
--   · คนในทีม/เจ้าของงาน เก็บรหัส + ชื่อ (ไม่ผูก FK employees — แบบเดียวกับ 5S)
--   · เขียน = has_perm('act_smf:manage') (คีย์ใหม่ · permission_catalog + role manager ตามที่ user เปิดให้ 5S)
-- ย้อนกลับ (ยังไม่มีข้อมูลจริง): drop table public.act03_idea_eval, public.act03_idea_image, public.act03_idea,
--   public.act03_project_month, public.act03_task, public.act03_team, public.act03_project cascade;
--   delete from public.role_permissions where permission_key = 'act_smf:manage'; delete from public.permission_catalog where resource = 'act_smf';

create table if not exists public.act03_project (
  act_project     uuid primary key default gen_random_uuid(),
  year            int  not null check (year between 2000 and 2100),
  code            text not null check (code ~ '^[a-z0-9_-]{1,20}$'),
  name            text not null check (char_length(name) between 1 and 120),
  sort_no         int  not null default 1,
  target_name     text,
  unit            text,
  team_type       text not null default 'team' check (team_type in ('team', 'individual')),
  target_type     text not null default 'plan' check (target_type in ('plan', 'count')),
  target_count    int  check (target_count is null or target_count >= 0),
  status          text not null default 'Active' check (status in ('Active', 'Inactive')),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  unique (year, code)
);

create table if not exists public.act03_team (
  act_team        uuid primary key default gen_random_uuid(),
  year            int  not null check (year between 2000 and 2100),
  employee_code   text not null check (employee_code ~ '^[0-9]{7}$'),
  employee_name   text,
  role            text not null check (role in ('chairman', 'vice', 'advisor', 'admin', 'member')),
  unit            text,                                  -- ว่าง = คณะกรรมการ · รหัสโครงการ = ทีมย่อยของโครงการนั้น
  department      text,
  status          text not null default 'Active' check (status in ('Active', 'Inactive')),
  team_key        text not null unique,                  -- act03|ปี|รหัส|บทบาท|unit (กันซ้ำ)
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  constraint act03_team_sub_roles check (unit is null or role in ('chairman', 'vice', 'member'))
);

create table if not exists public.act03_task (
  act_task        uuid primary key default gen_random_uuid(),
  year            int  not null check (year between 2000 and 2100),
  parent_id       uuid references public.act03_task (act_task) on delete cascade,
  sort_no         int  not null default 1,
  title           text not null check (char_length(title) between 1 and 200),
  start_date      date,
  end_date        date,
  progress        int  not null default 0 check (progress between 0 and 100),
  owner_code      text,
  owner_name      text,
  unit            text,                                  -- รหัสโครงการ (ข้อหลัก)
  color           text,
  note            text,
  done_on         date,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  constraint act03_task_dates check ((start_date is null) = (end_date is null) and (end_date is null or end_date >= start_date)),
  constraint act03_task_sub_has_dates check (parent_id is null or start_date is not null)
);

create table if not exists public.act03_project_month (
  act_project     uuid not null references public.act03_project (act_project) on delete cascade,
  month           int  not null check (month between 1 and 12),
  target          numeric(14, 2),
  actual          numeric(14, 2),
  note            text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  primary key (act_project, month)
);

create table if not exists public.act03_idea (
  act_idea              uuid primary key default gen_random_uuid(),
  year                  int  not null check (year between 2000 and 2100),
  project_code          text not null default 'workflow',
  team_name             text,
  employee_code         text not null,
  full_name             text not null,
  department            text,
  members               text[] not null default '{}',
  process_name          text not null,
  current_description   text,
  current_problem       text,
  frequency             text,
  project_name          text not null,
  improvement_description text,
  proposed_technology   text,
  improvement_benefits  jsonb not null default '[]'::jsonb,
  time_before           numeric(10, 2) not null default 0,
  time_after            numeric(10, 2) not null default 0,
  paper_before          numeric(10, 2) not null default 0,
  paper_after           numeric(10, 2) not null default 0,
  steps_before          numeric(10, 2) not null default 0,
  steps_after           numeric(10, 2) not null default 0,
  difficulty            text check (difficulty is null or difficulty in ('Easy', 'Medium', 'Hard')),
  budget                text check (budget is null or budget in ('Free', 'Low', 'Medium', 'High')),
  project_status        text not null default 'Idea' check (project_status in ('Idea', 'Prototype', 'Testing', 'Implemented')),
  admin_note            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  updated_by_name       text
);

create table if not exists public.act03_idea_image (
  act_image       uuid primary key default gen_random_uuid(),
  act_idea        uuid not null references public.act03_idea (act_idea) on delete cascade,
  image_type      text not null check (image_type in ('BEFORE', 'AFTER')),
  image_url       text not null,
  image_description text,
  created_at      timestamptz not null default now()
);

create table if not exists public.act03_idea_eval (
  act_eval        uuid primary key default gen_random_uuid(),
  act_idea        uuid not null references public.act03_idea (act_idea) on delete cascade,
  evaluator_code  text not null,
  evaluator_name  text,
  evaluation_note text,
  evaluation_status text,
  created_at      timestamptz not null default now()
);

create index if not exists act03_team_year_idx on public.act03_team (year);
create index if not exists act03_task_year_idx on public.act03_task (year);
create index if not exists act03_idea_year_idx on public.act03_idea (year);

-- สิทธิ์ (คีย์ใหม่ต้องอยู่ใน permission_catalog — ด่าน permissionCatalogCoverage)
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'act_smf', 'manage', 'Smart Factory: ตั้งค่า (โครงการ · ทีม · แผนงาน) + บันทึกผลงาน', 'คุณภาพ & วิศวกรรม', 791
where not exists (select 1 from public.permission_catalog where resource = 'act_smf' and action = 'manage');
insert into public.role_permissions (role, permission_key, allowed)
values ('manager', 'act_smf:manage', true)
on conflict (role, permission_key) do nothing;

-- เปิด RLS ทุกตาราง (แยกบรรทัดให้ด่าน new-table-needs-rls อ่านเจอ)
alter table public.act03_project enable row level security;
alter table public.act03_team enable row level security;
alter table public.act03_task enable row level security;
alter table public.act03_project_month enable row level security;
alter table public.act03_idea enable row level security;
alter table public.act03_idea_image enable row level security;
alter table public.act03_idea_eval enable row level security;

-- RLS + GRANT + trigger (อ่าน = login · เขียน = act_smf:manage) · ไม่มีคำสั่ง drop
do $$
declare t text;
begin
  foreach t in array array['act03_project', 'act03_team', 'act03_task', 'act03_project_month', 'act03_idea', 'act03_idea_image', 'act03_idea_eval'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_write') then
      execute format('create policy %I on public.%I for all to authenticated using ((select public.has_perm(''act_smf:manage''))) with check ((select public.has_perm(''act_smf:manage'')))', t || '_write', t);
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

-- โครงการตั้งต้นปี 2026 (เหมือนเว็บเดิม)
insert into public.act03_project (year, code, name, sort_no, target_name, unit, team_type, target_type, target_count) values
  (2026, 'oee',      'Smart OEE',            1, 'OEE',        '%',  'team', 'plan',  null),
  (2026, 'vision',   'Vision Camera',        2, 'Accuracy',   '%',  'team', 'plan',  null),
  (2026, 'workflow', 'Work Flow Automation', 3, 'Time Saved', 'ชม.', 'team', 'count', 10)
on conflict (year, code) do nothing;

notify pgrst, 'reload schema';
-- ✅ ลงแล้ว 2026-11-28 ผ่าน MCP (apply_migration 20261128b_act03_smf_main) · ตรวจ: ตาราง 7 · RLS 7 · policy 14 · โครงการ 3 · สิทธิ์ manager 1
