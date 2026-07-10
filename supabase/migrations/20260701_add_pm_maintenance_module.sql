-- ⚠️ DEPRECATED (2026-07-10 — QC audit): ตาราง pm_equipment / pm_checklists / pm_checkpoints
-- ชุดนี้ไม่มีโค้ดใน src/ ใช้แล้ว — โมดูล PM จริงย้ายไปใช้ jigs/checklists/jig_checkpoints/inspections
-- ฝั่ง DR project (eyhclzkifitbhbljgoav) แทนทั้งหมด อย่าสับสนชื่อที่ใกล้กัน: `pm_checklists` (Main,
-- ตกค้าง) ≠ `checklists` (DR, ใช้งานจริง) — เก็บไฟล์ไว้เป็นประวัติ ยังไม่ drop ตารางจนกว่าจะยืนยันไม่มีข้อมูลค้าง
--
-- PM Maintenance Module — tables for preventive maintenance workflows
-- Merged from Preventive-Maintenance-Online project into 4M's primary Supabase.
-- All tables use pm_ prefix to avoid conflicts with 4M's existing schema.
-- RLS: USING (true) for all authenticated users (role filtering done in UI layer,
-- consistent with 4M's existing pattern for other tables).

-- ─── pm_equipment ─────────────────────────────────────────────────────────────
create table if not exists public.pm_equipment (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  image_path      text,
  jig_no          text,
  process         text,
  model           text,
  part_name       text,
  part_no         text,
  line_name       text,
  machine_no      text,
  equipment_type  text not null default 'jig',
  module          text not null default 'mtn',
  layout_type     text not null default 'image_pin',
  is_active       boolean not null default true,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint pm_equipment_type_check   check (equipment_type in ('jig','die','machine','fixture','tool')),
  constraint pm_equipment_layout_check check (layout_type    in ('image_pin','list')),
  constraint pm_equipment_module_check check (module         in ('mtn','qa'))
);

alter table public.pm_equipment enable row level security;

create policy pm_equipment_select on public.pm_equipment for select to authenticated using (true);
create policy pm_equipment_insert on public.pm_equipment for insert to authenticated with check (true);
create policy pm_equipment_update on public.pm_equipment for update to authenticated using (true);
create policy pm_equipment_delete on public.pm_equipment for delete to authenticated using (true);

-- ─── pm_checklists ────────────────────────────────────────────────────────────
-- One physical equipment has a separate checklist per department so each dept
-- checks the same machine/jig with a different frequency and checkpoint set.
create table if not exists public.pm_checklists (
  id           uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.pm_equipment(id) on delete cascade,
  name         text not null,
  module       text not null default 'mtn',
  department   text not null default 'maintenance',
  frequency    text not null default 'monthly',
  description  text,
  is_active    boolean not null default true,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  constraint pm_checklists_module_check    check (module     in ('mtn','qa')),
  constraint pm_checklists_freq_check      check (frequency  in ('daily','weekly','monthly','quarterly','periodic')),
  constraint pm_checklists_dept_check      check (department in ('production','maintenance','jig_maintenance','die_maintenance','qa')),
  unique (equipment_id, module, department)
);

alter table public.pm_checklists enable row level security;

create policy pm_checklists_select on public.pm_checklists for select to authenticated using (true);
create policy pm_checklists_insert on public.pm_checklists for insert to authenticated with check (true);
create policy pm_checklists_update on public.pm_checklists for update to authenticated using (true);
create policy pm_checklists_delete on public.pm_checklists for delete to authenticated using (true);

-- ─── pm_checkpoints ───────────────────────────────────────────────────────────
create table if not exists public.pm_checkpoints (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.pm_checklists(id) on delete cascade,
  name         text not null,
  description  text,
  type         text not null default 'attribute',
  unit         text,
  spec_min     numeric,
  spec_max     numeric,
  nominal      numeric,
  sort_order   int not null default 0,
  image_path   text,
  created_at   timestamptz not null default now(),
  constraint pm_checkpoints_type_check check (type in ('variable','attribute','note'))
);

alter table public.pm_checkpoints enable row level security;

create policy pm_checkpoints_select on public.pm_checkpoints for select to authenticated using (true);
create policy pm_checkpoints_insert on public.pm_checkpoints for insert to authenticated with check (true);
create policy pm_checkpoints_update on public.pm_checkpoints for update to authenticated using (true);
create policy pm_checkpoints_delete on public.pm_checkpoints for delete to authenticated using (true);

-- ─── pm_inspections ───────────────────────────────────────────────────────────
create table if not exists public.pm_inspections (
  id               uuid primary key default gen_random_uuid(),
  checklist_id     uuid not null references public.pm_checklists(id) on delete restrict,
  inspector_id     uuid references auth.users(id),
  inspected_at     timestamptz not null default now(),
  status           text not null default 'pending',
  approval_status  text not null default 'pending',
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  constraint pm_inspections_status_check   check (status          in ('pending','pass','fail','warning')),
  constraint pm_inspections_approval_check check (approval_status in ('pending','approved','rejected'))
);

alter table public.pm_inspections enable row level security;

create policy pm_inspections_select on public.pm_inspections for select to authenticated using (true);
create policy pm_inspections_insert on public.pm_inspections for insert to authenticated with check (true);
create policy pm_inspections_update on public.pm_inspections for update to authenticated using (true);
create policy pm_inspections_delete on public.pm_inspections for delete to authenticated using (true);

-- ─── pm_inspection_results ────────────────────────────────────────────────────
create table if not exists public.pm_inspection_results (
  id             uuid primary key default gen_random_uuid(),
  inspection_id  uuid not null references public.pm_inspections(id) on delete cascade,
  checkpoint_id  uuid not null references public.pm_checkpoints(id) on delete restrict,
  value_text     text,
  value_num      numeric,
  value_num2     numeric,
  value_num3     numeric,
  is_ok          boolean,
  notes          text,
  image_path     text,
  created_at     timestamptz not null default now(),
  unique (inspection_id, checkpoint_id)
);

alter table public.pm_inspection_results enable row level security;

create policy pm_inspection_results_select on public.pm_inspection_results for select to authenticated using (true);
create policy pm_inspection_results_insert on public.pm_inspection_results for insert to authenticated with check (true);
create policy pm_inspection_results_update on public.pm_inspection_results for update to authenticated using (true);
create policy pm_inspection_results_delete on public.pm_inspection_results for delete to authenticated using (true);

-- ─── pm_schedules ─────────────────────────────────────────────────────────────
-- overdue_days NOT a generated column — current_date is not immutable in Postgres.
-- Compute overdue in application code: next_due_date < today.
create table if not exists public.pm_schedules (
  id                   uuid primary key default gen_random_uuid(),
  checklist_id         uuid not null references public.pm_checklists(id) on delete cascade,
  last_done_at         timestamptz,
  next_due_date        date,
  last_inspection_id   uuid references public.pm_inspections(id),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  unique (checklist_id)
);

alter table public.pm_schedules enable row level security;

create policy pm_schedules_select on public.pm_schedules for select to authenticated using (true);
create policy pm_schedules_insert on public.pm_schedules for insert to authenticated with check (true);
create policy pm_schedules_update on public.pm_schedules for update to authenticated using (true);
create policy pm_schedules_delete on public.pm_schedules for delete to authenticated using (true);

-- ─── Storage bucket for PM images ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pm-images', 'pm-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy if not exists "pm_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'pm-images');

create policy if not exists "pm_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pm-images');

create policy if not exists "pm_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'pm-images');

create policy if not exists "pm_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pm-images');
