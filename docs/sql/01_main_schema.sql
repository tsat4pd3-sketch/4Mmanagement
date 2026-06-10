-- ═══════════════════════════════════════════════════════════════
-- ESM — Enterprise Shopfloor Management
-- MAIN PROJECT SCHEMA (โปรเจค Supabase หลัก)
-- รันใน SQL Editor ของ Supabase โปรเจคหลัก ตามลำดับไฟล์:
--   01_main_schema.sql  →  03_seed_data.sql
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. ไลน์ผลิต ────────────────────────────────────────────────
create table if not exists production_lines (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  section         text,                       -- PD1 / PD2 / PD3 / PD4
  std_day_shift   integer default 0,          -- กำลังคนมาตรฐานกะเช้า
  std_night_shift integer default 0,          -- กำลังคนมาตรฐานกะดึก
  created_at      timestamptz default now()
);

-- ─── 2. พนักงาน ─────────────────────────────────────────────────
create table if not exists employees (
  id               uuid primary key default gen_random_uuid(),
  employee_id_code text,                      -- รหัสพนักงาน เช่น EMP001
  name             text not null,
  position         text,                      -- Operator / Leader / Technician / Engineer / QC
  department       text,
  section          text,                      -- PD1–PD4
  group_name       text,
  team             text,                      -- A / B / C  (C = กะเช้าตลอด)
  line_id          uuid references production_lines(id) on delete set null,
  image_url        text,
  is_active        boolean default true,
  created_by       uuid,
  created_at       timestamptz default now()
);

-- ─── 3. User profiles (เชื่อมกับ Supabase Auth) ─────────────────
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text,
  role          text not null default 'leader',  -- admin / manager / supervisor / leader / qa
  section       text,
  line_id       uuid references production_lines(id) on delete set null,
  team          text,
  notify_email  text,
  signature_url text,
  created_at    timestamptz default now()
);

-- Trigger: สร้าง profile อัตโนมัติเมื่อมี user ใหม่
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 4. สถานีงาน + ผังไลน์ ──────────────────────────────────────
create table if not exists workstations (
  id              serial primary key,
  line_name       text not null,
  station_name    text not null,              -- เช่น OP10
  pos_top         numeric,                    -- ตำแหน่ง % บนผังไลน์
  pos_left        numeric,
  skill_allowance boolean default false,      -- จุดงานได้ค่าฝีมือ
  created_at      timestamptz default now()
);

create table if not exists station_requirements (
  id         uuid primary key default gen_random_uuid(),
  station_id integer references workstations(id) on delete cascade,
  skill_name text not null,
  min_score  integer default 70 check (min_score between 0 and 100)
);

create table if not exists line_layouts (
  id         uuid primary key default gen_random_uuid(),
  line_name  text not null unique,
  image_url  text,
  created_at timestamptz default now()
);

create table if not exists employee_home_positions (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references employees(id) on delete cascade,
  station_id  integer references workstations(id) on delete cascade,
  line_name   text,
  updated_at  timestamptz default now()
);

-- ─── 5. ทักษะ ───────────────────────────────────────────────────
create table if not exists skill_definitions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,            -- รหัสทักษะ เช่น Welding
  label      text,                            -- ชื่อแสดงผลภาษาไทย
  color      text,
  category   text default 'hard_skill',       -- hard_skill / machine_skill / product_skill / soft_skill
  sort_order integer default 0
);

create table if not exists employee_skills (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  skill_name  text not null,
  score       integer default 0 check (score between 0 and 120),
  updated_at  timestamptz default now(),
  unique (employee_id, skill_name)
);

-- ─── 6. เช็คชื่อ + PPE + ลางาน รายวัน ──────────────────────────
create table if not exists daily_production_logs (
  id              uuid primary key default gen_random_uuid(),
  work_date       date not null,
  employee_id     uuid not null references employees(id) on delete cascade,
  is_present      boolean default false,
  assigned_line   integer references workstations(id) on delete set null,  -- สถานีที่ assign วันนี้
  shift           text,                       -- day / night
  has_helmet      boolean default false,
  has_boots       boolean default false,
  has_gloves      boolean default false,
  has_ot          boolean default false,
  has_extended_ot boolean default false,      -- OT พิเศษ 20:00–23:00
  remark          text,
  leave_type      text,                       -- ลากิจ / ลาป่วย / ลาพักร้อน
  leave_duration  text,                       -- full / half / hours
  leave_period    text,                       -- morning / afternoon
  leave_hours     numeric,
  checked_by      uuid,
  created_at      timestamptz default now(),
  unique (work_date, employee_id)
);

-- ─── 7. งานนอกไลน์ ─────────────────────────────────────────────
create table if not exists operator_special_tasks (
  id          uuid primary key default gen_random_uuid(),
  work_date   date not null,
  employee_id uuid not null references employees(id) on delete cascade,
  task_type   text,                           -- 5ส / คัดงาน / แก้ไขปัญหาคุณภาพ / งานปรับปรุงไลน์ / อื่นๆ
  created_at  timestamptz default now(),
  unique (employee_id, work_date)
);

-- ─── 8. กะการทำงาน ─────────────────────────────────────────────
create table if not exists shift_schedules (
  id         uuid primary key default gen_random_uuid(),
  work_date  date not null,
  line_id    uuid not null references production_lines(id) on delete cascade,
  day_team   text not null,                   -- A หรือ B (กะดึก = ทีมตรงข้าม)
  created_by uuid,
  created_at timestamptz default now(),
  unique (work_date, line_id)
);

create table if not exists shift_overrides (
  id          uuid primary key default gen_random_uuid(),
  work_date   date not null,
  employee_id uuid not null references employees(id) on delete cascade,
  shift       text not null,                  -- day / night
  reason      text,
  created_by  uuid,
  created_at  timestamptz default now(),
  unique (work_date, employee_id)
);

create table if not exists shift_merge_events (
  id           uuid primary key default gen_random_uuid(),
  section      text,                          -- ระบุอย่างใดอย่างหนึ่ง: section หรือ line_id
  line_id      uuid references production_lines(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  target_shift text not null,                 -- day / night
  reason       text,
  created_by   uuid,
  created_at   timestamptz default now()
);

-- ─── 9. 4M Change Logs ─────────────────────────────────────────
create table if not exists four_m_logs (
  id                uuid primary key default gen_random_uuid(),
  work_date         date not null,
  line_name         text,
  category          text not null,            -- Man / Machine / Material / Method
  description       text,
  requires_qa       boolean default false,
  change_subtype    text,                     -- same_ok / cross_skill_ok / cross_needs_ojt / change / method_update
  status            text default 'pending',   -- pending / pending_doc / pending_qa / approved / rejected
  request_image_url text,                     -- รูปหลักฐาน OJT
  qa_image_url      text,                     -- รูปตรวจสอบจาก QA
  reject_reason     text,
  created_by        uuid,
  sv_approved_by    uuid,
  approved_by       uuid,
  created_at        timestamptz default now()
);

-- ─── 10. Notifications (in-app) ────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references profiles(id) on delete cascade,
  title      text,
  body       text,
  type       text default 'info',             -- success / error / info
  is_read    boolean default false,
  ref_table  text,
  ref_id     uuid,
  created_at timestamptz default now()
);

-- ─── 11. PPE master (ถ้าใช้โมดูล PPE แบบละเอียด) ───────────────
create table if not exists ppe_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer default 0
);

create table if not exists ppe_requirements (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid references production_lines(id) on delete cascade,
  ppe_item_id uuid references ppe_items(id) on delete cascade
);

create table if not exists ppe_checks (
  id          uuid primary key default gen_random_uuid(),
  work_date   date not null,
  employee_id uuid references employees(id) on delete cascade,
  ppe_item_id uuid references ppe_items(id) on delete cascade,
  passed      boolean default false,
  created_at  timestamptz default now()
);

-- ─── 12. Indexes ────────────────────────────────────────────────
create index if not exists idx_dpl_work_date    on daily_production_logs(work_date);
create index if not exists idx_dpl_employee     on daily_production_logs(employee_id);
create index if not exists idx_4m_work_date     on four_m_logs(work_date);
create index if not exists idx_4m_status        on four_m_logs(status);
create index if not exists idx_skills_emp       on employee_skills(employee_id);
create index if not exists idx_schedules_date   on shift_schedules(work_date);
create index if not exists idx_notif_user       on notifications(user_id, is_read);

-- ─── 13. Row Level Security ────────────────────────────────────
-- เปิด RLS ทุกตาราง + policy พื้นฐาน: ผู้ใช้ที่ login แล้วอ่าน/เขียนได้
-- (ปรับให้เข้มขึ้นภายหลังตามนโยบายบริษัทได้)
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
    and tablename in (
      'production_lines','employees','profiles','workstations','station_requirements',
      'line_layouts','employee_home_positions','skill_definitions','employee_skills',
      'daily_production_logs','operator_special_tasks','shift_schedules','shift_overrides',
      'shift_merge_events','four_m_logs','notifications','ppe_items','ppe_requirements','ppe_checks'
    )
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "authenticated_all" on %I', t);
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ─── 14. Storage bucket สำหรับรูปภาพ ───────────────────────────
insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;

drop policy if exists "photos_read"   on storage.objects;
drop policy if exists "photos_insert" on storage.objects;
drop policy if exists "photos_update" on storage.objects;
create policy "photos_read"   on storage.objects for select using (bucket_id = 'employee-photos');
create policy "photos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'employee-photos');
create policy "photos_update" on storage.objects for update to authenticated using (bucket_id = 'employee-photos');
