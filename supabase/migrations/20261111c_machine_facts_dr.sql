-- 🏭 ข้อมูลจากเครื่อง (ข้อเท็จจริง) — สถานะหยุด/เดิน + นับชิ้น จาก Node-RED/SCADA → ESM
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-11 · คำสั่ง user "เริ่ม OEE Line D3"
-- 📄 docs/modules/integration-hub.md §OEE · ออกแบบตาม docs/SCADA_REALTIME_DESIGN.md §4 (ปรับตามที่ต้นทางส่งจริง)
--
-- 🔴 เฟส "เดินคู่" (SCADA doc §6 ข้อ 2-3): ข้อมูลชุดนี้ **ยังไม่ถูกเอาไปคิด OEE** — ใช้เทียบกับที่คนลงเท่านั้น
-- 🔴 ESM เป็นเจ้าของสูตร — ไม่รับเลข OEE/A/P/Q ที่ต้นทางคิด
-- ต่างจากแบบใน SCADA doc:
--   · ข้อเท็จจริงเก็บ "รหัสเครื่องของต้นทาง" (machine_tag) — ผูกกับ machines.id ผ่าน machine_tag_map ตอนอ่าน
--     ⇒ แก้การจับคู่แล้วข้อมูลย้อนหลังตามเอง ไม่ต้อง backfill · tag ที่ยังไม่ผูก = ไม่ทิ้ง รอคนยืนยัน
--   · machine_counters เก็บ "จำนวนต่อนาที" (ต้นทาง PD2 ส่งรายชิ้น ไม่มีตัวนับสะสม) — stroke_total ว่างได้
-- client เขียนไม่ได้เลย: ข้อเท็จจริงเขียนโดย edge ingest-energy · การจับคู่เขียนโดย edge integration-admin
-- additive ล้วน · ย้อน: ท้ายไฟล์

create table if not exists public.machine_tag_map (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.integration_sources(id) on delete cascade,
  tag         text not null,                        -- รหัสเครื่องฝั่งต้นทาง (เช่น JTSRA03-03)
  machine_id  uuid references public.machines(id),  -- ★ ผูกด้วย id ไม่ใช่ machine_no · null = ยังไม่ผูก
  confirmed_by text,
  confirmed_at timestamptz,
  unique (source_id, tag)
);

create table if not exists public.machine_state_events (
  source_id     uuid not null references public.integration_sources(id) on delete cascade,
  machine_tag   text not null,
  started_at    timestamptz not null,               -- เวลาจากฝั่งเครื่อง
  ended_at      timestamptz,
  duration_sec  numeric,
  state         text not null check (state in ('fault','idle','planned_stop','no_plan','comm_loss','other')),
  source_state  text,                               -- ค่าดิบของต้นทาง (FAULT/IDLE/PLANNED_STOP/NO_PLAN/COMM_LOSS)
  reason_code   int,
  reason_text   text,                               -- เหตุผลที่กดหน้าเครื่อง (ต้นทางเลือกจาก master ของมัน)
  is_minor      boolean not null default false,     -- ต้นทางจัดเป็นหยุดสั้น (micro-stop → กระทบ P ไม่ใช่ A)
  received_at   timestamptz not null default now(), -- ★ คู่กับ started_at เสมอ (นาฬิกา 2 แหล่ง · SCADA doc §5.6)
  primary key (source_id, machine_tag, started_at)  -- ส่งซ้ำ = ทับ (ช่วงเดิมจบแล้วค่าเท่าเดิม)
);
create index if not exists machine_state_events_time_idx on public.machine_state_events (started_at desc);

create table if not exists public.machine_counters (
  source_id     uuid not null references public.integration_sources(id) on delete cascade,
  machine_tag   text not null,
  counted_at    timestamptz not null,               -- ต้นนาที
  delta         int not null check (delta >= 0),    -- ชิ้นในนาทีนั้น (นับจากเครื่อง)
  ng_delta      int not null default 0 check (ng_delta >= 0),   -- NG ที่กดหน้าเครื่อง (ข้อมูลเสนอ — Q ยังมาจากคน/QA)
  stroke_total  bigint,                             -- ตัวนับสะสม ถ้าต้นทางมี (PD2 ไม่มี)
  received_at   timestamptz not null default now(),
  primary key (source_id, machine_tag, counted_at)  -- ส่งซ้ำ = ทับด้วยยอดของนาทีนั้นที่ครบกว่า
);
create index if not exists machine_counters_time_idx on public.machine_counters (counted_at desc);

alter table public.machine_tag_map      enable row level security;
alter table public.machine_state_events enable row level security;
alter table public.machine_counters     enable row level security;
do $$ declare t text; begin
  foreach t in array array['machine_tag_map','machine_state_events','machine_counters'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to anon, authenticated using (true)', t);
    execute format('revoke all on public.%1$s from anon, authenticated', t);
    execute format('grant select on public.%1$s to anon, authenticated', t);
  end loop;
end $$;

comment on table public.machine_state_events is
  'ข้อมูลจากเครื่อง: ช่วงหยุด (ศูนย์เชื่อมต่อ) · เฟสเดินคู่ ยังไม่เข้าสูตร OEE · เขียนโดย edge ingest-energy · เก็บ 90 วัน';
comment on table public.machine_counters is
  'ข้อมูลจากเครื่อง: ชิ้นต่อนาที · เฟสเดินคู่ ยังไม่เข้าสูตร OEE · เขียนโดย edge ingest-energy · เก็บ 90 วัน';

-- ตรวจ:
--   select has_table_privilege('anon','public.machine_counters','insert');   -- ต้อง false
-- ย้อน:
--   drop table if exists public.machine_counters; drop table if exists public.machine_state_events;
--   drop table if exists public.machine_tag_map;
