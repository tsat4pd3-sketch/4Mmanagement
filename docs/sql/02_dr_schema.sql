-- ═══════════════════════════════════════════════════════════════
-- ESM — Daily Production Report (DR) SCHEMA
-- รันใน SQL Editor ของ Supabase "โปรเจคที่ 2" (Daily Report)
-- หรือจะรันในโปรเจคเดียวกับโปรเจคหลักก็ได้ (แล้วตั้ง ENV ให้ชี้ project เดียวกัน)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. สินค้า / Model ──────────────────────────────────────────
create table if not exists dr_products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  line_name        text,                      -- ไลน์ที่ผลิตสินค้านี้ (ใช้กรอง dropdown ตอนเปิดกะ)
  cycle_time_sec   integer default 0,         -- Cycle time ต่อชิ้น (วินาที) — ใช้คำนวณ OEE-P
  target_per_shift integer default 0,         -- เป้าผลิตต่อกะ
  process_type     text default 'common',     -- common / welding / assembly ฯลฯ (ใช้จับคู่ break policy)
  is_active        boolean default true,
  created_at       timestamptz default now()
);

-- ─── 2. Kanban Standard (Master ของ Tag Card) ───────────────────
create table if not exists kanban_standards (
  id             uuid primary key default gen_random_uuid(),
  mat_no         text not null unique,        -- MAT.NO บนบาร์โค้ด — สแกนแล้ว auto-fill
  part_name      text,
  p_no           text,
  customer       text,
  qty_per_kanban integer default 0,           -- จำนวนชิ้นต่อ 1 kanban (auto-fill ตอนสแกนเปิด)
  product_id     uuid references dr_products(id) on delete set null,
  is_active      boolean default true,
  created_at     timestamptz default now()
);

-- ─── 3. ประเภท Downtime ─────────────────────────────────────────
create table if not exists dr_downtime_types (
  id         uuid primary key default gen_random_uuid(),
  name_th    text not null,
  color      text default '#ef4444',
  category   text default 'unplanned',        -- planned (ในแผน) / unplanned (นอกแผน)
  is_active  boolean default true,
  sort_order integer default 0
);

-- ─── 4. ประเภทงานเสีย ───────────────────────────────────────────
create table if not exists dr_defect_types (
  id         uuid primary key default gen_random_uuid(),
  name_th    text not null,
  color      text default '#ef4444',
  is_active  boolean default true,
  sort_order integer default 0
);

-- ─── 5. นโยบายหยุดพัก (ตัดเวลาออกจาก OEE อัตโนมัติ) ────────────
create table if not exists break_policies (
  id           uuid primary key default gen_random_uuid(),
  name         text,                          -- เช่น "พักเที่ยง"
  shift        text default 'both',           -- day / night / both
  process_type text default 'common',         -- common = ทุก process
  start_time   text not null,                 -- HH:MM
  duration_min integer not null,
  is_active    boolean default true,
  sort_order   integer default 0
);

-- ─── 6. เครื่องจักร ─────────────────────────────────────────────
create table if not exists machines (
  id         uuid primary key default gen_random_uuid(),
  line_name  text,
  machine_no text not null,
  name       text,
  is_active  boolean default true,
  sort_order integer default 0
);

-- ─── 7. กะผลิต (Session) ────────────────────────────────────────
create table if not exists production_sessions (
  id             uuid primary key default gen_random_uuid(),
  work_date      date not null,
  line_name      text not null,
  section        text,
  shift          text not null default 'day', -- day / night
  status         text not null default 'open',-- open / closed
  product_id     uuid references dr_products(id) on delete set null,
  start_time     text,                        -- HH:MM
  end_time       text,
  opened_by_name text,
  opened_by_uid  uuid,
  closed_by_name text,
  closed_by_uid  uuid,
  closed_at      timestamptz,
  -- ผลสรุปตอนปิดกะ
  shift_min      integer,                     -- ระยะเวลากะ (นาที)
  actual_qty     integer default 0,           -- ยอดผลิตรวม
  qty_ok         integer default 0,
  qty_ng         integer default 0,
  qty_suspect    integer default 0,
  qty_repair     integer default 0,
  ng_qty         integer default 0,           -- (legacy เท่ากับ qty_ng)
  qty_ng_rh      integer default 0,           -- (legacy ไม่ใช้แล้ว)
  qty_ng_lh      integer default 0,           -- (legacy ไม่ใช้แล้ว)
  oee_a          numeric,                     -- Availability %
  oee_p          numeric,                     -- Performance %
  oee_q          numeric,                     -- Quality %
  oee            numeric,                     -- OEE % รวม
  created_at     timestamptz default now()
);

-- ─── 8. Prod Orders (Tag Card ที่สแกนเปิด/ปิด) ──────────────────
create table if not exists prod_orders (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references production_sessions(id) on delete cascade,
  prod_no      text not null,                 -- PROD.NO จากบาร์โค้ด
  mat_no       text,
  part_name    text,
  p_no         text,
  customer     text,
  qty          integer not null default 0,    -- จำนวนตามแผน
  qty_ok       integer,                       -- จำนวนที่ confirm ตอนปิด order
  qty_actual   integer,                       -- จำนวนที่ทำได้จริงก่อนยกยอด (carry-over)
  status       text not null default 'open',  -- open / confirmed / carry_over / imported / cancelled
  opened_by    text,
  opened_at    timestamptz default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  carry_over_from_session_id uuid,            -- ยกยอดมาจากกะไหน
  carry_over_note            text
);

-- ─── 9. Downtime Logs ───────────────────────────────────────────
create table if not exists downtime_logs (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references production_sessions(id) on delete cascade,
  downtime_type_id uuid references dr_downtime_types(id) on delete set null,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_min     numeric,
  machine_no       text,
  description      text,
  reported_by_name text,
  reported_by_uid  uuid,
  created_at       timestamptz default now()
);

-- ─── 10. Defect Logs (งานเสีย/สงสัย/ซ่อม) ───────────────────────
create table if not exists defect_logs (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references production_sessions(id) on delete cascade,
  defect_type_id   uuid references dr_defect_types(id) on delete set null,
  prod_order_id    uuid references prod_orders(id) on delete set null,  -- optional
  qty_ng           integer default 0,
  qty_suspect      integer default 0,
  qty_repair       integer default 0,
  description      text,
  reported_by_name text,
  reported_by_uid  uuid,
  logged_at        timestamptz default now()
);

-- ─── 11. Indexes ────────────────────────────────────────────────
create index if not exists idx_sessions_date_status on production_sessions(work_date, status);
create index if not exists idx_sessions_line        on production_sessions(line_name);
create index if not exists idx_orders_session       on prod_orders(session_id);
create index if not exists idx_orders_status        on prod_orders(status);
create index if not exists idx_dt_session           on downtime_logs(session_id);
create index if not exists idx_defect_session       on defect_logs(session_id);

-- ─── 12. Row Level Security ─────────────────────────────────────
-- หมายเหตุ: ระบบเดิมใช้ DR project แยกที่ client เข้าผ่าน anon key
-- จึงเปิด policy ให้ anon ใช้งานได้ — ถ้าต้องการความปลอดภัยสูงขึ้น
-- ให้รวม DR เข้าโปรเจคเดียวกับ Auth แล้วเปลี่ยน "to anon, authenticated"
-- เป็น "to authenticated"
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
    and tablename in (
      'dr_products','kanban_standards','dr_downtime_types','dr_defect_types',
      'break_policies','machines','production_sessions','prod_orders',
      'downtime_logs','defect_logs'
    )
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app_all" on %I', t);
    execute format(
      'create policy "app_all" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ─── 13. เปิด Realtime ──────────────────────────────────────────
-- จำเป็นสำหรับ live update บนหน้า Dashboard / Daily Report
alter publication supabase_realtime add table production_sessions;
alter publication supabase_realtime add table prod_orders;
alter publication supabase_realtime add table downtime_logs;
alter publication supabase_realtime add table defect_logs;
