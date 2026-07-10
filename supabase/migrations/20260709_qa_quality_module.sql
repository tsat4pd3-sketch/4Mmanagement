-- QA/QC Quality Control module (หน้า /qa — Quality Control Center)
-- Target project: MAIN (ewhdfqwfwofivojtsizn) — client `supabase` (authenticated)
-- ห้าม apply กับ DR project (ฝั่งนั้น client เป็น anon เสมอ — ดู CLAUDE.md)
--
-- PURELY ADDITIVE — ตารางใหม่ 5 ตาราง + seed permission ใหม่ 3 key
-- ไม่มีการแก้ตาราง/นโยบายเดิมใดๆ
--
--   qa_characteristics  master จุดควบคุม SPC (part + characteristic + spec)
--   qa_measurements     ผลวัดรายกลุ่มย่อย (subgroup) เก็บเป็น numeric[]
--   qa_ncr              ใบรายงานสิ่งที่ไม่เป็นไปตามข้อกำหนด (NCR) + disposition
--   qa_capa             8D corrective action (D1-D8) ผูก NCR ได้
--   qa_instruments      ทะเบียนเครื่องมือวัด + กำหนดสอบเทียบ
--
-- Permission keys ใหม่:
--   page:/qa    เข้าหน้า Quality Control Center
--   qa:record   บันทึกผลวัด SPC / เปิด-อัปเดต NCR / เปิด-อัปเดต CAPA
--   qa:manage   จัดการ master (characteristics, instruments), ลบข้อมูล,
--               ตัดสิน disposition และปิด NCR/CAPA

-- ── 1) SPC master: จุดควบคุม (control characteristic) ──────────────────────
create table if not exists qa_characteristics (
  id              uuid primary key default gen_random_uuid(),
  part_no         text not null,
  part_name       text,
  line_name       text,
  characteristic  text not null,          -- เช่น "ความกว้างร่อง A", "Torque bolt M8"
  unit            text,                   -- mm, N·m, ...
  nominal         numeric,                -- ค่ากลาง/target
  usl             numeric,                -- upper spec limit
  lsl             numeric,                -- lower spec limit
  subgroup_size   int not null default 5 check (subgroup_size between 1 and 10),
  gauge           text,                   -- เครื่องมือวัดที่ใช้
  control_method  text,                   -- อ้างอิง control plan เช่น "CP-HDF-001 #12"
  is_active       boolean not null default true,
  created_by      text,
  created_at      timestamptz not null default now()
);

-- ── 2) ผลวัด: 1 แถว = 1 subgroup ────────────────────────────────────────────
create table if not exists qa_measurements (
  id                 uuid primary key default gen_random_uuid(),
  characteristic_id  uuid not null references qa_characteristics(id) on delete cascade,
  work_date          date not null,
  shift              text check (shift in ('day','night')),
  readings           numeric[] not null,  -- ค่าวัดในกลุ่มย่อย ยาว = subgroup_size
  operator_name      text,
  note               text,
  created_by         text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_qa_measurements_char_date
  on qa_measurements (characteristic_id, work_date, created_at);

-- ── 3) NCR ──────────────────────────────────────────────────────────────────
create table if not exists qa_ncr (
  id               uuid primary key default gen_random_uuid(),
  ncr_no           text not null unique,          -- NCR-YYYYMM-#### (gen ฝั่ง client)
  report_date      date not null,
  line_name        text,
  part_no          text,
  part_name        text,
  source           text not null default 'inprocess'
                   check (source in ('incoming','inprocess','final','customer')),
  severity         text not null default 'minor'
                   check (severity in ('minor','major','critical')),
  defect_desc      text not null,
  qty_found        int  not null default 0,       -- จำนวนที่ตรวจพบ/กักกัน
  qty_ng           int  not null default 0,
  containment      text,                          -- มาตรการกักกันชั่วคราว
  disposition      text check (disposition in ('use_as_is','rework','sort','scrap','return_supplier')),
  disposition_note text,
  disposition_by   text,
  root_cause       text,
  status           text not null default 'open'
                   check (status in ('open','containment','disposition','closed')),
  created_by       text,
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        text
);
create index if not exists idx_qa_ncr_status_date on qa_ncr (status, report_date);

-- ── 4) CAPA / 8D ────────────────────────────────────────────────────────────
create table if not exists qa_capa (
  id             uuid primary key default gen_random_uuid(),
  capa_no        text not null unique,            -- CAPA-YYYYMM-####
  ncr_id         uuid references qa_ncr(id) on delete set null,
  title          text not null,
  owner_name     text,
  due_date       date,
  d1_team        text,
  d2_problem     text,
  d3_containment text,
  d4_root_cause  text,
  d5_corrective  text,
  d6_implement   text,
  d7_prevent     text,
  d8_closure     text,
  effectiveness  text,                            -- ผลตรวจติดตามประสิทธิผล
  status         text not null default 'open'
                 check (status in ('open','in_progress','verify','closed')),
  created_by     text,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create index if not exists idx_qa_capa_status_due on qa_capa (status, due_date);

-- ── 5) ทะเบียนเครื่องมือวัด ─────────────────────────────────────────────────
create table if not exists qa_instruments (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,          -- รหัสเครื่องมือ เช่น VC-001
  name             text not null,                 -- Vernier Caliper 0-150
  inst_type        text,                          -- caliper / micrometer / torque ...
  brand            text,
  serial_no        text,
  range_spec       text,                          -- 0-150 mm
  resolution       text,                          -- 0.01 mm
  location         text,
  line_name        text,
  cal_freq_months  int not null default 12,
  last_calibrated  date,
  cal_by           text,                          -- หน่วยงานสอบเทียบ
  cert_no          text,
  status           text not null default 'active'
                   check (status in ('active','repair','retired')),
  remark           text,
  created_at       timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- อ่าน: ทุก authenticated / เขียน: gate ด้วย has_perm() (fail-closed, admin bypass ใน fn)
alter table qa_characteristics enable row level security;
alter table qa_measurements    enable row level security;
alter table qa_ncr             enable row level security;
alter table qa_capa            enable row level security;
alter table qa_instruments     enable row level security;

drop policy if exists qa_characteristics_select on qa_characteristics;
create policy qa_characteristics_select on qa_characteristics
  for select to authenticated using (true);
drop policy if exists qa_characteristics_write on qa_characteristics;
create policy qa_characteristics_write on qa_characteristics
  for all to authenticated
  using ((select has_perm('qa:manage')))
  with check ((select has_perm('qa:manage')));

drop policy if exists qa_measurements_select on qa_measurements;
create policy qa_measurements_select on qa_measurements
  for select to authenticated using (true);
drop policy if exists qa_measurements_insert on qa_measurements;
create policy qa_measurements_insert on qa_measurements
  for insert to authenticated
  with check ((select has_perm('qa:record')));
drop policy if exists qa_measurements_modify on qa_measurements;
create policy qa_measurements_modify on qa_measurements
  for update to authenticated
  using ((select has_perm('qa:manage')))
  with check ((select has_perm('qa:manage')));
drop policy if exists qa_measurements_delete on qa_measurements;
create policy qa_measurements_delete on qa_measurements
  for delete to authenticated
  using ((select has_perm('qa:manage')));

drop policy if exists qa_ncr_select on qa_ncr;
create policy qa_ncr_select on qa_ncr
  for select to authenticated using (true);
drop policy if exists qa_ncr_insert on qa_ncr;
create policy qa_ncr_insert on qa_ncr
  for insert to authenticated
  with check ((select has_perm('qa:record')));
drop policy if exists qa_ncr_update on qa_ncr;
create policy qa_ncr_update on qa_ncr
  for update to authenticated
  using ((select has_perm('qa:record')))
  with check ((select has_perm('qa:record')));
drop policy if exists qa_ncr_delete on qa_ncr;
create policy qa_ncr_delete on qa_ncr
  for delete to authenticated
  using ((select has_perm('qa:manage')));

drop policy if exists qa_capa_select on qa_capa;
create policy qa_capa_select on qa_capa
  for select to authenticated using (true);
drop policy if exists qa_capa_insert on qa_capa;
create policy qa_capa_insert on qa_capa
  for insert to authenticated
  with check ((select has_perm('qa:record')));
drop policy if exists qa_capa_update on qa_capa;
create policy qa_capa_update on qa_capa
  for update to authenticated
  using ((select has_perm('qa:record')))
  with check ((select has_perm('qa:record')));
drop policy if exists qa_capa_delete on qa_capa;
create policy qa_capa_delete on qa_capa
  for delete to authenticated
  using ((select has_perm('qa:manage')));

drop policy if exists qa_instruments_select on qa_instruments;
create policy qa_instruments_select on qa_instruments
  for select to authenticated using (true);
drop policy if exists qa_instruments_write on qa_instruments;
create policy qa_instruments_write on qa_instruments
  for all to authenticated
  using ((select has_perm('qa:manage')))
  with check ((select has_perm('qa:manage')));

-- ── Seed permissions ────────────────────────────────────────────────────────
-- catalog (โผล่ในหน้า จัดการสิทธิ์ อัตโนมัติ)
insert into permission_catalog (resource, action, label, group_name, sort) values
  ('qa', 'record', 'QA: บันทึกผลวัด SPC / เปิด NCR / เปิด CAPA',                 'รายงาน/คุณภาพ', 50),
  ('qa', 'manage', 'QA: จัดการ master, disposition, ปิด NCR/CAPA, เครื่องมือวัด', 'รายงาน/คุณภาพ', 51)
on conflict (resource, action) do nothing;

-- role_permissions: seed เฉพาะแถว allowed=true (แถวที่ไม่มี = false, fail-closed)
insert into role_permissions (role, permission_key, allowed)
select r::user_role, k, true
from (values
  ('page:/qa',  array['admin','manager','supervisor','leader','qa','document_control']),
  ('qa:record', array['admin','manager','supervisor','leader','qa']),
  ('qa:manage', array['admin','manager','qa'])
) as seed(k, roles)
cross join lateral unnest(seed.roles) as r
on conflict (role, permission_key) do nothing;
