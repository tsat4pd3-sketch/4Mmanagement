-- ══ KPI เฟส 2 — KPI นอกระบบกรอกมือ + เป้ารายปี (Main · 2026-08-24 · คำสั่ง user) ══
-- "data ที่เหลือให้กรอกเองด้วย" — DL/OH % (จากบัญชี) · Customer Satisfaction · Safety · HR ฯลฯ
-- ที่ระบบคำนวณเองไม่ได้ → เก็บเป็น "นิยาม KPI รายปี" + "ค่ารายเดือนที่คนกรอก"
-- ใช้ในแท็บ 📑 KPI รายเดือน (/dept-dashboard?view=kpi) + export Excel 3 ชีทตามฟอร์ม FM-HRM-6-022/024/025
--
-- กติกา:
-- - นิยามผูก (year, section) — section null = ใช้ทุกส่วนงาน (pattern เดียวกับ lpa_questions.line_name)
-- - source: 'manual' = กรอกมือ · 'auto:<key>' = สำรองไว้ map กับแถวคำนวณอัตโนมัติ (produce/ng/ppm/cost_defect/oee/dt)
-- - RLS data-driven ผ่าน has_perm('kpi:manage') ตามกฎ "RLS ก็ต้อง data-driven"
-- - audit + updated_at ตามกฎ "ตาราง master/editable ต้องมี audit"

create table if not exists public.kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  section text,                         -- null = ทุกส่วนงาน
  category text not null default 'internal'
    check (category in ('financial','customer','internal','learning')),
  seq int not null default 0,
  name text not null,
  formula_text text,                    -- คอลัมน์ Formula ในชีท Monitoring
  scope_text text,                      -- คอลัมน์ Scope เช่น "Data from Acc" / "Data from HRM"
  commitment text,                      -- ข้อความ Commitment (เช่น "≤ 1.452%")
  target text,                          -- ข้อความ Target
  target_value numeric,                 -- ค่าเป้าตัวเลข (ใช้ตัดสิน Y/N)
  direction text check (direction in ('up','down')),  -- up = ยิ่งมากยิ่งดี (≥เป้า) · down = ยิ่งน้อยยิ่งดี (≤เป้า)
  weight numeric,                       -- น้ำหนักในใบ Appraisal
  source text not null default 'manual',
  action_plan text,                     -- IMPROVEMENT ACTIVITY (ชีท Action FM-HRM-6-025)
  action_owner text,                    -- RESPONSIBILITY
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_kpi_definitions_year on public.kpi_definitions (year, section);

create table if not exists public.kpi_manual_entries (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.kpi_definitions(id) on delete cascade,
  month int not null check (month between 1 and 12),
  value numeric,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kpi_id, month)
);

-- ── RLS: อ่าน = ทุกคนที่ login · เขียน = has_perm('kpi:manage') ──
alter table public.kpi_definitions enable row level security;
alter table public.kpi_manual_entries enable row level security;

drop policy if exists kpi_definitions_read on public.kpi_definitions;
create policy kpi_definitions_read on public.kpi_definitions
  for select to authenticated using (true);
drop policy if exists kpi_definitions_write on public.kpi_definitions;
create policy kpi_definitions_write on public.kpi_definitions
  for all to authenticated
  using (public.has_perm('kpi:manage'))
  with check (public.has_perm('kpi:manage'));

drop policy if exists kpi_manual_entries_read on public.kpi_manual_entries;
create policy kpi_manual_entries_read on public.kpi_manual_entries
  for select to authenticated using (true);
drop policy if exists kpi_manual_entries_write on public.kpi_manual_entries;
create policy kpi_manual_entries_write on public.kpi_manual_entries
  for all to authenticated
  using (public.has_perm('kpi:manage'))
  with check (public.has_perm('kpi:manage'));

-- ── audit + updated_at (fn_audit / fn_set_updated_at มีอยู่แล้วบน Main) ──
do $$
declare t text;
begin
  foreach t in array array['kpi_definitions','kpi_manual_entries'] loop
    execute format('drop trigger if exists trg_%s_audit on public.%I', t, t);
    execute format('create trigger trg_%s_audit after insert or update or delete on public.%I
                    for each row execute function public.fn_audit()', t, t);
    execute format('drop trigger if exists trg_%s_updated on public.%I', t, t);
    execute format('create trigger trg_%s_updated before update on public.%I
                    for each row execute function public.fn_set_updated_at()', t, t);
  end loop;
end $$;

-- ── ทะเบียนสิทธิ์ (กฎ: เพิ่ม action ใหม่ต้องลง permission_catalog ไม่งั้น admin ปรับจาก UI ไม่ได้) ──
-- group_name ต้องเป็นชื่อหมวดตาม NAV_GROUP_ORDER · sort ช่วง 1xx (ภาพรวม) — 110 = factory_map:edit → ใช้ 120
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'kpi', 'manage', 'KPI รายเดือน — กรอก/แก้ KPI นอกระบบ (DL/OH/Satisfaction/Safety/HR)', 'ภาพรวม', 120
where not exists (
  select 1 from public.permission_catalog where resource = 'kpi' and action = 'manage'
);

-- ── seed สิทธิ์แบบระบุ role ชัดเจน (ห้าม enum_range — กับดัก role ใหม่ fail-closed) ──
-- admin bypass ในโค้ดอยู่แล้ว · dept_admin = bucket ให้แอดมินหน่วยงานกรอกของหน่วยงานตัวเอง
insert into public.role_permissions (role, permission_key, allowed)
select v.r::user_role, 'kpi:manage', true
from (values ('manager'), ('supervisor'), ('dept_admin')) v(r)
where not exists (
  select 1 from public.role_permissions
  where role = v.r::user_role and permission_key = 'kpi:manage'
);
