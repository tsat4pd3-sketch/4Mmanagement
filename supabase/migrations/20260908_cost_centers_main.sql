-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ทะเบียน Cost Center (cost_centers master) — 2026-09-08 · คำสั่ง user "ลุยเลย" หลัง single-source audit 2026-09-07
--
-- ที่มา: รหัส cost center ถูกพิมพ์เองที่ production_lines.cost_center · org_nodes.cost_center · cost_center_rates.cost_center
-- (3 ที่ · join ด้วยสตริง) · พิมพ์ผิดตัวเดียว = rate ไม่ผูกไลน์เงียบๆ · ใบ OT / MO / ใบเบิก อ่านรหัสนี้ไปพิมพ์
-- โมเดล: คอลัมน์ cost_center ของตารางอื่นยังเก็บ code (text) เหมือนเดิม ไม่ผูก FK (ย้อนได้ · ข้อมูลเก่าไม่กระทบ)
-- seed = ทุกรหัสที่มีอยู่จริง 3 แหล่ง · name เอาจากชื่อไลน์/ชื่อหน่วยงานที่ใช้รหัสนั้น (รหัสที่มีแค่ใน rates ได้ name ว่างให้คนเติม)
-- สิทธิ์: อ่านได้ทุกคนที่ login · เขียน = has_perm('cost_rate:manage') (คีย์เดียวกับปุ่มในแผง Cost Center ที่ /org-setup)

create table if not exists public.cost_centers (
  code            text primary key,
  name            text not null default '',
  section         text,
  note            text,
  sort_order      integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.cost_centers is
  'ทะเบียน Cost Center — production_lines / org_nodes / cost_center_rates เก็บ code (text) เหมือนเดิม · แก้ที่ /org-setup แผง Cost Center';

alter table public.cost_centers enable row level security;
drop policy if exists cost_centers_select on public.cost_centers;
create policy cost_centers_select on public.cost_centers for select to authenticated using (true);
drop policy if exists cost_centers_write on public.cost_centers;
create policy cost_centers_write on public.cost_centers for all to authenticated
  using (public.has_perm('cost_rate:manage'))
  with check (public.has_perm('cost_rate:manage'));

drop trigger if exists trg_cost_centers_updated on public.cost_centers;
create trigger trg_cost_centers_updated before update on public.cost_centers for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_cost_centers_audit on public.cost_centers;
create trigger trg_cost_centers_audit after insert or update or delete on public.cost_centers for each row execute function public.fn_audit();

-- ═══ seed จาก 3 แหล่ง (ชื่อไลน์ก่อน → ชื่อหน่วยงาน → ว่าง) รันซ้ำได้ ═══
with src as (
  select btrim(cost_center) as code, name, section, 1 as pri from public.production_lines where cost_center is not null and btrim(cost_center) <> ''
  union all
  select btrim(cost_center), name, null, 2 from public.org_nodes where cost_center is not null and btrim(cost_center) <> ''
  union all
  select btrim(cost_center), '', null, 3 from public.cost_center_rates where cost_center is not null and btrim(cost_center) <> ''
), pick as (
  select distinct on (code) code, name, section from src order by code, pri, name
)
insert into public.cost_centers (code, name, section)
select code, coalesce(name, ''), section from pick
on conflict (code) do nothing;
