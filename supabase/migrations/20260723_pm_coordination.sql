-- แผนประสานงาน PM ข้ามวัน (MTN แจ้ง Production) — DR project (eyhclzkifitbhbljgoav)
-- ใบแบบเมล "RE: แผนการ ..." — งาน PM/แก้เครื่องที่กินหลายวัน + ระบุทีมรับผิดชอบแต่ละวัน
-- + ช่วง Production Support (เวลา) แล้วแจ้ง Production/ผู้เกี่ยวข้องอัตโนมัติ (Telegram)
create table if not exists public.pm_coordination_plans (
  id uuid primary key default gen_random_uuid(),
  title        text not null,            -- หัวเรื่องงาน เช่น "Cleaning Cutting Head"
  machine_id   uuid,                      -- machines.id (จากฐานเครื่องจักร) — nullable กันเครื่องนอกทะเบียน
  machine_no   text,                      -- เลขเครื่อง (snapshot)
  machine_name text,                      -- ชื่อเครื่อง (snapshot เช่น Laser LS-10)
  line_name    text,                      -- ไลน์ของเครื่อง
  remark       text,                      -- หมายเหตุ/ช่วง support (freeform)
  pm_plan_id   uuid,                      -- ผูกแผน PM เดิม (pm_plans.id) ถ้ามี — optional
  status       text default 'draft',      -- draft / notified / done / cancelled
  created_by   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.pm_coordination_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.pm_coordination_plans(id) on delete cascade,
  task_date   date,                       -- วันที่ของขั้นงาน
  team        text,                       -- ทีมรับผิดชอบ (mtn_teams key / production ฯลฯ)
  description text,                        -- รายละเอียดขั้นงาน
  time_from   text,                        -- 'HH:MM' (ช่วงเวลานัด — optional)
  time_to     text,
  is_support  boolean default false,       -- flag "รบกวน Production Support" (เน้นสีเมื่อ true)
  done        boolean default false,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

alter table public.pm_coordination_plans enable row level security;
alter table public.pm_coordination_tasks enable row level security;
do $$ begin
  create policy pm_coordination_plans_all on public.pm_coordination_plans for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy pm_coordination_tasks_all on public.pm_coordination_tasks for all using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.pm_coordination_plans to anon, authenticated;
grant all on public.pm_coordination_tasks to anon, authenticated;
create index if not exists idx_pm_coord_task_plan on public.pm_coordination_tasks(plan_id);
create index if not exists idx_pm_coord_task_date on public.pm_coordination_tasks(task_date);
create index if not exists idx_pm_coord_plan_machine on public.pm_coordination_plans(machine_id);
