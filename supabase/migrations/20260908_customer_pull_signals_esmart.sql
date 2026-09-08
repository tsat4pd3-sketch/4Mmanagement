-- ══ 📥 สัญญาณดึงงานจากลูกค้า (Customer Pull Signal) — e-SMART ของ Ford/AAT ════════════════════
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ที่มา (user 2026-09-08 · ฝ่าย Logistic แจ้ง):
--   "ลูกค้า AAT เรียกงานไม่ตรงตาม 862 · เค้าจะส่ง e-SMART มาให้ในระบบ user โหลดออกมาทุกๆ 2 ชั่วโมง
--    รอบ 8-10 โมง จะเป็นการส่งงานในรอบ 11:00"
--   "e-SMART คือข้อมูลที่อัพเดทสุดท้ายก่อนจะส่งของ **เหมือนการยืนยัน order จากลูกค้า**
--    AAT ก็คือ update data ของช่วงเวลานั้นไป · **ส่วนตัวไหนที่ไม่มีใน e-SMART แปลว่าตรงกับ 862**"
--
-- ⇒ โมเดล: **862 = แผน · e-SMART = ยอดยืนยันสุดท้าย** — อัพโหลดแล้ว "อัพเดทเฉพาะพาร์ทที่อยู่ในไฟล์"
--    พาร์ทที่ไม่อยู่ในไฟล์ = ไม่แตะ (862 ถูกอยู่แล้ว) · ห้ามลบ/ห้าม zero-out แถวที่หายจากไฟล์
--
-- ⚠️ additive ล้วน — ตาราง/คอลัมน์ใหม่ nullable ทั้งหมด · โค้ดเก่าอ่าน customer_shipping_orders
--    ได้เหมือนเดิมทุกประการ (qty ยังเป็น "ยอดที่ต้องส่งจริง" เหมือนเดิม) · rollback ท้ายไฟล์

/* ── 1) โปรไฟล์รูปแบบไฟล์ (data-driven — รองรับลูกค้า/ฟอร์แมตอื่นโดยไม่แก้โค้ด) ────────────
   เหตุผลที่ต้อง data-driven: **ไฟล์รายงานตัวเดียวกันยังใช้ชื่อหัวไม่ตรงกัน** —
   ไฟล์ .csv เขียน `username` / `GSDBCODE` แต่ .xlsx ของรายงานเดียวกันเขียน `CDSID` / `GSDB`
   ⇒ ทุก field ต้องเทียบได้ "หลายชื่อ" (alias array) ไม่ใช่ชื่อเดียวตายตัว
   ลูกค้าเจ้าใหม่/ฟอร์แมตใหม่ = เพิ่ม 1 แถวที่นี่ ไม่ต้อง deploy */
create table if not exists public.customer_pull_formats (
  code             text primary key,
  name             text not null,
  ship_to_codes    text[] not null default '{}',   -- ship-to ที่ใช้โปรไฟล์นี้ ({} = ใช้ได้ทุกเจ้า)
  detect_keywords  text[] not null default '{}',   -- คำในหัวไฟล์ที่ใช้ auto-detect โปรไฟล์
  meta_map         jsonb  not null default '{}'::jsonb,  -- ค่าในหัวไฟล์ → { ship_to:[alias…], window_start:[…], window_end:[…] }
  col_map          jsonb  not null default '{}'::jsonb,  -- คอลัมน์ในตาราง → { part_prefix:[alias…], qty:[…] … }
  part_join        text   not null default '-',    -- วิธีประกอบเลขพาร์ท prefix+base+suffix
  qty_mode         text   not null default 'containers_x_qty'
                     check (qty_mode in ('containers_x_qty','qty_only')),
  ts_format        text   not null default 'MDY'   -- ลำดับวันในคอลัมน์เวลา (MDY = 09/08/2026 คือ 8 ก.ย.)
                     check (ts_format in ('MDY','DMY','ISO')),
  lead_min         integer not null default 60,    -- ปลายช่วงเวลา + N นาที = รอบส่งที่ลูกค้ามารับ (milk-run)
  is_active        boolean not null default true,
  note             text,
  updated_at       timestamptz default now(),
  updated_by_name  text
);
comment on table public.customer_pull_formats is
  'โปรไฟล์รูปแบบไฟล์สัญญาณดึงงานของลูกค้า (e-SMART ฯลฯ) — เพิ่มลูกค้า/ฟอร์แมตใหม่ = เพิ่มแถว ไม่ต้องแก้โค้ด · ตัวอ่านอยู่ src/utils/pullSignal.js';
comment on column public.customer_pull_formats.col_map is
  'ชื่อคอลัมน์ที่ยอมรับต่อ field (array = alias หลายสะกด) — ไฟล์รายงานเดียวกันยังใช้ชื่อหัวต่างกันระหว่าง .csv กับ .xlsx';
comment on column public.customer_pull_formats.lead_min is
  'ปลายช่วงเวลาในไฟล์ + N นาที = รอบส่ง (user 2026-09-08: "8:00-10:00 บวกไป 1 ชั่วโมงเป็น 11:00 คือรอบที่ลูกค้ามารับงาน เพราะเป็นการส่งแบบ milkrun")';

/* ── 2) ก้อนการนำเข้า (batch) — แยกจาก demand_upload_batches ของ 862/830 โดยตั้งใจ ──────────
   demand_upload_batches มีปุ่มลบใน PlannerSales ที่ cascade ลบ customer_shipping_orders.batch_id
   ⇒ เอา e-SMART ไปปนจะโดนลบพลอย และรายการ batch ของ Sales จะรกด้วยไฟล์ที่คนละสายงาน */
create table if not exists public.customer_pull_batches (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'esmart',
  format_code   text references public.customer_pull_formats(code) on delete set null,
  ship_to       text,
  file_name     text,
  window_start  timestamptz,
  window_end    timestamptz,
  work_date     date,
  ship_time     text,          -- รอบส่งที่ใช้ตอน apply (HH:MM บนกรอบวันงาน)
  row_count     integer not null default 0,   -- แถวในไฟล์
  new_signals   integer not null default 0,   -- แถวที่นับเป็นของใหม่ (ไม่ซ้ำกับที่นำเข้าแล้ว)
  orders_updated integer not null default 0,
  orders_created integer not null default 0,
  orders_skipped integer not null default 0,  -- ใบที่เตรียม/ส่งไปแล้ว → ไม่แตะ
  uploaded_by   text,
  uploaded_at   timestamptz default now(),
  note          text
);
create index if not exists customer_pull_batches_recent_idx
  on public.customer_pull_batches (ship_to, work_date desc, uploaded_at desc);

/* ── 3) แถวดิบจากไฟล์ = หลักฐาน ห้ามแก้ ────────────────────────────────────────────────
   1 แถว = 1 ครั้งที่ลูกค้าดึงภาชนะออกจาก market ของเขา (replenishment pull) */
create table if not exists public.customer_pull_signals (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid references public.customer_pull_batches(id) on delete set null,
  source            text not null default 'esmart',
  ship_to           text not null,               -- Plant Code (GRBNA) → ship_to_plants.code
  supplier_ref      text,                        -- SMART Number (เลขภายในของลูกค้า เช่น 150524)
  customer_part_no  text not null,               -- Prefix-Base-Suffix (RB3B-16E060-BA) → dr_products.p_no
  part_name         text,
  pulled_at         timestamptz not null,        -- Replenishment time stamp (เวลาไทย)
  containers        numeric not null default 1,  -- Containers Used
  qty_per_container numeric,                     -- Part Quantity (จำนวนต่อภาชนะ)
  qty               numeric not null default 0,  -- containers × qty_per_container (ตาม qty_mode)
  dock_code         text,                        -- Market Row (B5) — ตรงกับ customer_shipping_orders.dock_code
  market_area       text,
  market_rack       text,
  lsa               text,                        -- Line Side Address ฝั่งลูกค้า
  lp                text,                        -- License Plate
  window_start      timestamptz,
  window_end        timestamptz,
  work_date         date,                        -- วันงาน (กรอบ 08:00→08:00) ของรอบส่งปลายทาง
  ship_time         text,                        -- รอบส่งที่แถวนี้ถูกรวมเข้า (HH:MM)
  mat_no            text,                        -- MAT SAP ที่จับคู่ได้ตอน apply (null = จับคู่ไม่ได้ — ไม่เดา)
  raw               jsonb,
  created_at        timestamptz default now()
);
comment on table public.customer_pull_signals is
  'แถวดิบจากไฟล์สัญญาณดึงงานของลูกค้า (e-SMART) = หลักฐานว่าลูกค้าดึงอะไรไปตอนไหน — สร้าง/อัพเดท customer_shipping_orders จากยอดรวมของแถวเหล่านี้ ห้ามแก้ย้อนหลัง';

/* ⚠️ กันนำเข้าซ้ำ — user โหลดไฟล์ทุก 2 ชม. ช่วงเวลาคาบเกี่ยวกันได้ง่าย (โหลดซ้ำ/โหลดย้อน)
   คีย์ธรรมชาติ: ลูกค้า + พาร์ทของลูกค้า + เวลาที่ดึง — ดึง 2 ภาชนะวินาทีเดียวกันไฟล์รายงานเป็น
   Containers Used = 2 แถวเดียว (ไม่แตกแถว) จึงไม่ชนกันเอง
   ชนคีย์ = "เคยนำเข้าแล้ว" → ตัวนำเข้าต้องรายงานจำนวนที่ข้าม **ห้ามเงียบ** */
create unique index if not exists customer_pull_signals_dedup_idx
  on public.customer_pull_signals (source, ship_to, coalesce(supplier_ref, customer_part_no), pulled_at);
create index if not exists customer_pull_signals_lookup_idx
  on public.customer_pull_signals (ship_to, work_date, ship_time);

/* ── 4) ร่องรอยการยืนยันบนใบส่ง (additive · nullable) ─────────────────────────────────
   ⭐ `qty` **ยังเป็นยอดที่ต้องส่งจริงเหมือนเดิม** — ทุกจอที่อ่านอยู่แล้ว (Rundown · StoreMonitor ·
      FlowTower · DeptDashboard · coverage ใน Delivery) จึงได้ยอดที่ลูกค้ายืนยันโดยไม่ต้องแก้โค้ด
      ส่วนยอดเดิมจาก 862 เก็บไว้ที่ plan_qty เพื่อเทียบ "แผน vs จริง" */
alter table public.customer_shipping_orders add column if not exists plan_qty      numeric;
alter table public.customer_shipping_orders add column if not exists confirm_source text;
alter table public.customer_shipping_orders add column if not exists confirmed_at   timestamptz;
alter table public.customer_shipping_orders add column if not exists pull_batch_id  uuid;
comment on column public.customer_shipping_orders.plan_qty is
  'ยอดตามแผน (EDI 862) ก่อนถูกยืนยันด้วยสัญญาณดึงจากลูกค้า — null = ยังไม่เคยถูกยืนยัน (qty = แผน)';
comment on column public.customer_shipping_orders.confirm_source is
  'ที่มาของการยืนยันยอด: esmart = ลูกค้ายืนยันผ่านไฟล์ pull signal · null = คนกดยืนยันเองบนจอ';

/* ── 5) RLS — DR convention: anon-open (supabaseDR ไม่ authenticate ดู CLAUDE.md) ───────── */
alter table public.customer_pull_formats  enable row level security;
alter table public.customer_pull_batches  enable row level security;
alter table public.customer_pull_signals  enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_pull_formats' and policyname='customer_pull_formats_all') then
    create policy customer_pull_formats_all on public.customer_pull_formats for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_pull_batches' and policyname='customer_pull_batches_all') then
    create policy customer_pull_batches_all on public.customer_pull_batches for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_pull_signals' and policyname='customer_pull_signals_all') then
    create policy customer_pull_signals_all on public.customer_pull_signals for all using (true) with check (true);
  end if;
end $$;

/* ── 6) seed โปรไฟล์ Ford e-SMART (Detailed SMART) ─────────────────────────────────────
   ถอดจากไฟล์จริง 2 ใบที่ user ส่งมา 2026-09-08 (.csv รอบ 12:00-14:00 · .xlsx รอบ 14:00-16:00)
   ⚠️ alias ต่างกันจริงระหว่าง 2 ไฟล์: username↔CDSID · GSDBCODE↔GSDB */
insert into public.customer_pull_formats
  (code, name, ship_to_codes, detect_keywords, meta_map, col_map, part_join, qty_mode, ts_format, lead_min, note)
values (
  'ford_esmart',
  'Ford e-SMART — Detailed SMART (Part Usage Report)',
  '{GRBNA}',
  '{"SMART Supplier","Detailed SMART","Part Usage Report"}',
  jsonb_build_object(
    'window_start', jsonb_build_array('Start Time'),
    'window_end',   jsonb_build_array('End Time'),
    'supplier_code',jsonb_build_array('GSDBCODE','GSDB'),
    'user',         jsonb_build_array('username','CDSID')
  ),
  jsonb_build_object(
    'ship_to',       jsonb_build_array('Plant Code'),
    'supplier_ref',  jsonb_build_array('SMART Number'),
    'part_prefix',   jsonb_build_array('Prefix'),
    'part_base',     jsonb_build_array('Base'),
    'part_suffix',   jsonb_build_array('Suffix'),
    'part_name',     jsonb_build_array('Part Description'),
    'pulled_at',     jsonb_build_array('Replenishment time stamp'),
    'containers',    jsonb_build_array('Containers Used'),
    'qty',           jsonb_build_array('Part Quantity'),
    'dock_code',     jsonb_build_array('Market Row'),
    'market_area',   jsonb_build_array('Market Area'),
    'market_rack',   jsonb_build_array('Market Rack'),
    'lsa',           jsonb_build_array('LSA'),
    'lp',            jsonb_build_array('LP')
  ),
  '-', 'containers_x_qty', 'MDY', 60,
  'AAT (GRBNA) โหลดจากพอร์ทัลลูกค้าทุก 2 ชม. · ปลายช่วง + 60 นาที = รอบ milk-run ที่ลูกค้ามารับ'
)
on conflict (code) do update set
  name = excluded.name, ship_to_codes = excluded.ship_to_codes,
  detect_keywords = excluded.detect_keywords, meta_map = excluded.meta_map,
  col_map = excluded.col_map, updated_at = now();

/* ══ ROLLBACK (ถอยได้เต็ม — ไม่กระทบข้อมูลเดิมของ customer_shipping_orders) ══════════════
drop index if exists public.customer_pull_signals_dedup_idx;
drop index if exists public.customer_pull_signals_lookup_idx;
drop table if exists public.customer_pull_signals;
drop table if exists public.customer_pull_batches;
drop table if exists public.customer_pull_formats;
alter table public.customer_shipping_orders drop column if exists plan_qty;
alter table public.customer_shipping_orders drop column if exists confirm_source;
alter table public.customer_shipping_orders drop column if exists confirmed_at;
alter table public.customer_shipping_orders drop column if exists pull_batch_id;
   ⚠️ ลำดับที่ปลอดภัย: revert โค้ด (ปุ่ม 📥 หายไป) ก่อน แล้วค่อยรัน rollback นี้
      ระหว่างที่โค้ดใหม่ยังอยู่แต่ยังไม่ apply migration: ปุ่มขึ้น แต่กด apply ไม่ได้ + toast บอกสาเหตุ (42P01)
══════════════════════════════════════════════════════════════════════════════════════ */
