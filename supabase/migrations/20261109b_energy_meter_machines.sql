-- ⚡ ตู้ไฟ (มิเตอร์บนบอร์ดค่าไฟสด) จ่ายให้เครื่องไหน — 2026-11-09 · คำสั่ง user "ผูกเลย"
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav)
--
-- ใช้ทำอะไร: ① การ์ดตู้บน /energy?tab=live บอกรายชื่อเครื่องใต้ตู้
--           ② ผังโรงงาน (/factory-map metric พลังงาน) รู้ว่าค่าสดของตู้ไหนตกอยู่ไลน์ไหน
--              ไลน์ = machines.line_name ของเครื่องที่ผูก (ไม่เก็บซ้ำ — ย้ายเครื่องข้ามไลน์แล้วผังตามเอง)
-- 🔴 ตู้ 1 ตู้จ่ายหลายไลน์ได้ (DB-LASER = LASER-345 + LASER-789) ⇒ ค่าสดแยกรายไลน์ไม่ได้
--    จอต้องเขียนว่า "รวมกับไลน์ X" ห้ามหารแบ่งเอง (ไม่มีมิเตอร์รายไลน์ = ไม่รู้สัดส่วนจริง)
-- additive ล้วน · ไม่มีตารางเดิมอ้างถึง

create table if not exists public.energy_meter_machines (
  scope_kind  text not null default 'zone',
  scope_name  text not null,
  machine_id  uuid not null references public.machines(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (scope_kind, scope_name, machine_id),
  foreign key (scope_kind, scope_name) references public.energy_live_meters(scope_kind, scope_name) on delete cascade
);
create index if not exists energy_meter_machines_machine_idx on public.energy_meter_machines (machine_id);

alter table public.energy_meter_machines enable row level security;
drop policy if exists energy_meter_machines_read on public.energy_meter_machines;
create policy energy_meter_machines_read on public.energy_meter_machines for select to anon, authenticated using (true);
grant select on public.energy_meter_machines to anon, authenticated;

drop trigger if exists trg_energy_meter_machines_audit on public.energy_meter_machines;
create trigger trg_energy_meter_machines_audit after insert or update or delete on public.energy_meter_machines
  for each row execute function public.fn_audit();

-- seed ตามที่ user ยืนยัน 09/11 (จับด้วย machine_no ตรงตัว + ไลน์ — ชื่อซ้ำรูปแบบแปลกไม่ถูกผูก)
--   DB-CNC   = Bending 4 เครื่อง ไลน์ HDF1-2
--   DB-ROBOT = robot ไลน์ HDF1-2
--   DB-LASER = เครื่องเลเซอร์ LASER-345 + LASER-789 (robot ในไลน์เลเซอร์ "ใช้ตู้แยก" — ไม่ผูก)
insert into public.energy_meter_machines (scope_kind, scope_name, machine_id)
select 'zone', x.panel, m.id
  from public.machines m
  join (values
    ('DB-CNC',   array['HDF1','HDF2'],           '^BD-\d+$'),
    ('DB-ROBOT', array['HDF1','HDF2'],           '^RB-\d+$'),
    ('DB-LASER', array['LASER-345','LASER-789'], '^LS-\d+$')
  ) as x(panel, lines, pat) on m.line_name = any(x.lines) and m.machine_no ~ x.pat
 where m.is_active
on conflict do nothing;

comment on table public.energy_meter_machines is
  'ตู้ไฟบนบอร์ดค่าไฟสด → เครื่องที่ตู้จ่ายให้ · ไลน์มาจาก machines.line_name · ตู้เดียวหลายไลน์ = ค่าสดแยกรายไลน์ไม่ได้';

-- Rollback: drop table public.energy_meter_machines;
