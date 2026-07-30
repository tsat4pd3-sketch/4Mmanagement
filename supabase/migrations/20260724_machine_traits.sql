-- ลักษณะเครื่องจักร (data-driven) — automation level + operation mode + gang count (2026-07-24)
-- คนละแกนกับ machine_type (กระบวนการ) · แก้/เพิ่มค่าเองได้ (ไม่ล็อก เผื่อโรงงานอื่นรูปแบบต่าง)
-- DR project · anon-open ตาม convention

create table if not exists public.machine_automation_levels (
  id bigint generated always as identity primary key,
  key text unique not null, label text not null, icon text, color text,
  sort_order int default 0, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now(), updated_by_name text
);
create table if not exists public.machine_operation_modes (
  id bigint generated always as identity primary key,
  key text unique not null, label text not null, icon text, color text,
  sort_order int default 0, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now(), updated_by_name text
);

insert into public.machine_automation_levels(key,label,icon,color,sort_order) values
  ('manual','Manual','✋','#f59e0b',1),
  ('semi_auto','Semi-Auto','🖐️','#3b82f6',2),
  ('auto','Automatic','🤖','#22c55e',3)
on conflict (key) do nothing;

insert into public.machine_operation_modes(key,label,icon,color,sort_order) values
  ('standalone','Standalone','🔲','#6b7280',1),
  ('gang','Gang (multi/stroke)','🧩','#a855f7',2),
  ('inline','Inline (flow)','➡️','#0ea5e9',3)
on conflict (key) do nothing;

alter table public.machines
  add column if not exists automation_level text,
  add column if not exists operation_mode   text,
  add column if not exists gang_count        integer;   -- ชิ้น/จังหวะ สำหรับ gang machine (null = 1)

-- RLS: เปิด anon (client DR ไม่มี JWT) — mirror ตาราง master อื่นฝั่ง DR
alter table public.machine_automation_levels enable row level security;
alter table public.machine_operation_modes  enable row level security;
drop policy if exists mal_all on public.machine_automation_levels;
drop policy if exists mom_all on public.machine_operation_modes;
create policy mal_all on public.machine_automation_levels for all to anon, authenticated using (true) with check (true);
create policy mom_all on public.machine_operation_modes  for all to anon, authenticated using (true) with check (true);

-- audit + updated_at trigger (fn_audit/fn_set_updated_at มีอยู่แล้วจาก 20260724_audit_log_dr.sql)
do $$
declare t text;
begin
  foreach t in array array['machine_automation_levels','machine_operation_modes'] loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
  end loop;
end $$;
