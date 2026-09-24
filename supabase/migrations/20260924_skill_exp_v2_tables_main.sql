-- ══════════════════════════════════════════════════════════════════════════
-- EXP farming v2 — โครงข้อมูล (Project: MAIN "MAIN" ewhdfqwfwofivojtsizn)
-- 2026-09-24 · คำสั่ง user: "อยากให้ได้ความมาตรฐาน ถ้าจะออโต้"
--
-- ทำไมต้องมี (สรุปจาก docs/SKILL-EXP-ALGORITHM-DESIGN.md):
--   สูตร v1 มี input ตัวเดียวคือ daily_production_logs.is_present ⇒ วัด "การมาทำงาน"
--   ไม่ใช่ "ความสามารถ" · +1/วัน เท่ากันทั้ง 4 ช่วงขั้น ทั้งที่ 0→25 กับ 75→100 คนละเรื่อง
--   วัดจริง 24/09: 88 คนถือระดับ >=75 · มีประวัติ OJT แค่ 25 คน · ใบอนุมัติขึ้น 75 แนบเอกสาร 0/168
--   ISO 9001:2015 §7.2 / IATF 16949 §7.2.1 ต้อง "ประเมินประสิทธิผล" — คะแนนจาก is_present
--   อย่างเดียวตอบ auditor ไม่ได้
--
-- ⚠️ ค่าคงที่ทุกตัวอยู่ใน skill_exp_config (ตารางนี้) **ห้าม hardcode ซ้ำในโค้ด/SQL ที่อื่น**
--    — ทั้ง SQL job และ src/utils/skillExp.js อ่านจากแถวนี้แถวเดียว (กัน drift 2 ที่)
--
-- ⚠️ additive ล้วน — ไม่แตะ employee_skills / fn_daily_skill_farm / fn_weekly_skill_update
--    ในไฟล์นี้ (ของเดิมทำงานต่อเหมือนเดิมทุกประการ) · ตัวสูตรอยู่ migration ถัดไป
--
-- Rollback (ย้อนได้ 100% — ยังไม่มีอะไรพึ่งพา):
--   drop table if exists public.employee_skill_evidence;
--   drop table if exists public.station_output_rollup;
--   drop table if exists public.skill_exp_config;
--   alter table public.station_requirements drop column if exists n_ref;
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. ค่าปรับแต่งอัลกอริทึม (data-driven — ปรับจากหน้าจอได้ ไม่ต้อง deploy) ────────
create table if not exists public.skill_exp_config (
  id                      integer primary key default 1 check (id = 1),
  algo_version            text    not null default 'v2',

  -- 🔴 false = shadow mode: คำนวณ + เก็บหลักฐาน + เขียน shadow_score
  --    แต่ **ไม่แตะ employee_skills.score** (v1 ยังทำงานปกติ) — เปิดเมื่อเทียบผลแล้วพอใจ
  is_enabled              boolean not null default false,

  -- ขา 1 ปริมาณสะสม: รอบที่คาดว่าถึง "ทำเองได้ตามมาตรฐาน" (ต่อสถานี override ที่ station_requirements.n_ref)
  n_ref_default           integer not null default 2000 check (n_ref_default > 0),

  -- การลืม (Globerson, Levin & Shtub 1989 — เป็นฟังก์ชันของความยาวช่วงหยุด ไม่ใช่ flat)
  grace_days              integer not null default 14 check (grace_days >= 0),
  decay_per_week          integer not null default 1  check (decay_per_week >= 0),

  -- ประตูขึ้นขั้น (Dreyfus 1980 — เปลี่ยนขั้น = เชิงคุณภาพ ไม่ใช่สะสมแต้ม)
  gate_50_parts           integer not null default 3  check (gate_50_parts >= 0),
  gate_50_changeover      integer not null default 1  check (gate_50_changeover >= 0),
  gate_75_abnormal        integer not null default 1  check (gate_75_abnormal >= 0),
  gate_75_needs_quality   boolean not null default true,
  gate_100_needs_trainer  boolean not null default true,
  gate_100_needs_doc      boolean not null default true,

  -- ประตูคุณภาพ: NG ของสถานีในวันที่คนนี้อยู่ แย่กว่าค่ากลางสถานีเกิน x เท่า = ขึ้นขั้นไม่ได้
  quality_window_days     integer not null default 30 check (quality_window_days > 0),
  quality_max_ratio       numeric not null default 1.5 check (quality_max_ratio > 0),

  updated_at              timestamptz not null default now(),
  updated_by              text
);

insert into public.skill_exp_config (id) values (1) on conflict (id) do nothing;

alter table public.skill_exp_config enable row level security;

drop policy if exists skill_exp_config_read on public.skill_exp_config;
create policy skill_exp_config_read on public.skill_exp_config
  for select to authenticated using (true);

-- เขียนได้เฉพาะคนที่มีสิทธิ์ปุ่มบนจอตัวเดียวกัน (กฎเหล็ก: has_perm ห้าม hardcode role array)
drop policy if exists skill_exp_config_write on public.skill_exp_config;
create policy skill_exp_config_write on public.skill_exp_config
  for update to authenticated
  using (has_perm('skills:run_weekly_update'))
  with check (has_perm('skills:run_weekly_update'));

revoke all on public.skill_exp_config from anon;

-- ── 2. ยอดผลิต/เหตุการณ์ราย ไลน์×วัน×กะ — sync มาจาก DR (edge function sync-station-output) ──
-- 🔴 ทำไมต้อง copy มาไว้ฝั่ง Main: attendance อยู่ Main · production อยู่ DR · join ข้าม project
--    ใน SQL ไม่ได้ · job farm ต้องรันเป็น SQL เดียวจบ ⇒ sync สรุปรายวันมาเก็บ (ไม่ใช่แถวดิบ)
-- 🔴 ระดับหยาบสุดที่ attribute ได้คือ ไลน์×กะ — DR ไม่มีคอลัมน์ผูกยอดผลิต/ของเสียกับ "คน" เลย
--    (ตรงกับวิธีที่งานวิจัย learning curve วัดจริง = ระดับสาย) · จอต้องเขียนกำกับว่าเป็นค่าเฉลี่ยของกะ
create table if not exists public.station_output_rollup (
  work_date     date    not null,
  line_name     text    not null,
  shift         text    not null,
  qty_ok        integer not null default 0,
  qty_ng        integer not null default 0,
  n_parts       integer not null default 0,   -- จำนวนรุ่น (mat_no) ที่ผลิตในกะนั้น
  n_changeover  integer not null default 0,   -- เปลี่ยนรุ่น = n_parts - 1 (>= 0)
  n_downtime    integer not null default 0,   -- ใบเครื่องหยุด = เหตุผิดปกติ
  n_defect_ev   integer not null default 0,   -- ใบบันทึกของเสีย
  parts_seen    text[]  not null default '{}',-- mat_no ที่ผลิต (cap 50 ตัว/กะ)
  synced_at     timestamptz not null default now(),
  primary key (work_date, line_name, shift)
);

create index if not exists station_output_rollup_line_date
  on public.station_output_rollup (line_name, work_date);

alter table public.station_output_rollup enable row level security;

drop policy if exists station_output_rollup_read on public.station_output_rollup;
create policy station_output_rollup_read on public.station_output_rollup
  for select to authenticated using (true);
-- ไม่มี policy เขียน — เขียนได้เฉพาะ edge function (service_role bypass RLS)

revoke all on public.station_output_rollup from anon;

-- ── 3. หลักฐานสะสมราย (พนักงาน × สกิล) — "ทำไมถึงได้คะแนนนี้" ต้องตอบได้ ────────────
-- ⚠️ ตารางนี้คือคำตอบของ ISO 9001 §7.2 — ไม่ใช่แค่ตัวช่วยคำนวณ
create table if not exists public.employee_skill_evidence (
  employee_id       uuid    not null references public.employees(id) on delete cascade,
  skill_name        text    not null,

  -- ขา 1 · ปริมาณ (หารตามจำนวนคนที่อยู่ในกะนั้น — ยอดเป็นของทั้งสาย ไม่ใช่ของคนเดียว)
  cum_cycles        bigint  not null default 0,
  days_worked       integer not null default 0,

  -- ขา 3 · ความหลากหลาย & ความผิดปกติ
  parts_seen        text[]  not null default '{}',
  n_changeover      integer not null default 0,
  n_abnormal        integer not null default 0,   -- downtime + ใบ 4M + ใบของเสีย

  -- ขา 2 · คุณภาพ (ประตู ไม่ใช่แต้ม — ของเสียเป็นของทั้งสาย โทษรายคนไม่ได้)
  ng_ratio          numeric,                      -- NG ช่วงที่คนนี้อยู่ / NG ค่ากลางของสถานี
  quality_ok        boolean,

  -- ขา 4 · การรับรอง
  has_ojt           boolean not null default false,
  ojt_post_score    integer,
  is_trainer        boolean not null default false,

  -- ผลลัพธ์
  shadow_score      integer,                      -- คะแนนตามสูตร v2 (shadow mode เขียนแต่ตัวนี้)
  certified_level   integer not null default 0,   -- ระดับที่ "มีหลักฐาน" — พื้นของ decay
  verified          boolean not null default false,
  gate_missing      text[]  not null default '{}',-- ขาดอะไรถึงจะขึ้นขั้นได้ (โชว์บนจอตรงๆ)
  last_worked_date  date,
  updated_at        timestamptz not null default now(),
  primary key (employee_id, skill_name)
);

create index if not exists employee_skill_evidence_skill
  on public.employee_skill_evidence (skill_name);

alter table public.employee_skill_evidence enable row level security;

drop policy if exists employee_skill_evidence_read on public.employee_skill_evidence;
create policy employee_skill_evidence_read on public.employee_skill_evidence
  for select to authenticated using (true);
-- ไม่มี policy เขียน — เขียนจาก SECURITY DEFINER job เท่านั้น (เหมือน skill_update_runs)

revoke all on public.employee_skill_evidence from anon;

-- ── 4. รอบอ้างอิงต่อสถานี (ต่างกันตาม CT/ความซับซ้อน) — null = ใช้ n_ref_default ──────
alter table public.station_requirements
  add column if not exists n_ref integer check (n_ref is null or n_ref > 0);

comment on column public.station_requirements.n_ref is
  'รอบสะสมที่คาดว่าถึง "ทำเองได้ตามมาตรฐาน" ของสถานีนี้ · null = ใช้ skill_exp_config.n_ref_default';
