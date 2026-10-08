-- ══ 📉 Monitoring Boards — ยกไฟล์ `1.Monitoring-<เดือน>.xlsx` ของทีมวางแผนเข้าระบบ ═══════
-- Target project: DR / "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา: user ส่งไฟล์ Excel มา 2026-10-01 — "ตอนนี้ทีมวางแผนจะต้องทำข้อมูลนี้ใน excel
--        เค้าอยากทำในระบบเรา ทำได้มั้ย" → "เอาทุกชีททุกหน้าเลย ให้โปรแกรมทำได้แบบนั้น"
--
-- 🔑 การตัดสินใจเชิงโครงสร้าง: **13 ชีทในไฟล์คือ "การตั้งค่า" ไม่ใช่ 13 หน้าจอ**
--    ทุกชีทรูปร่างเดียวกัน = พาร์ท × ช่วงเวลา × แถว · ต่างกันแค่ชุดแถวกับหน่วยคอลัมน์
--    ⇒ 3 ตารางนี้รองรับได้ทั้ง 13 ชีท และชีท/ไลน์ที่จะเพิ่มทีหลัง **โดยไม่ต้องแก้โค้ด**
--    (ENGINEERING-PRINCIPLES: data-driven ก่อน hardcode · single source of truth)
--    สูตรทุกตัวอยู่ใน `src/utils/monitorGrid.js` ที่เดียว — DB เก็บแค่ "ชื่อสูตร"
--
-- ⚠️ ทำไมอยู่ DR ไม่ใช่ Main: ตัวเลขพวกนี้คือยอดผลิต/สต๊อก/ออเดอร์ ซึ่งอยู่ DR ทั้งหมด
--    (prod_orders · line_stock_* · line_part_levels · dr_products · customer_shipping_orders)
--    เอาไว้ Main = ต้อง join ข้าม project ซึ่งทำไม่ได้ → ต้องดึง 2 ฝั่งมาเทียบในหน้าจอ
--    ⚠️ ผลพลอยได้: ตารางเหล่านี้เป็น anon-open เหมือนตาราง DR อื่นทั้งหมด (known gap
--    ที่บันทึกไว้ใน CLAUDE.md §Supabase Projects) — **ห้ามแก้เป็น `TO authenticated`**
--    เพราะ supabaseDR ไม่เคย authenticate (เคยทำพังทั้งระบบมาแล้ว)
--
-- Rollback: ท้ายไฟล์

-- ── 1) นิยามบอร์ด = 1 แถวต่อ 1 ชีท ────────────────────────────────────────────────────
create table if not exists monitor_boards (
  id               uuid primary key default gen_random_uuid(),
  board_key        text not null,              -- คีย์ถาวร ใช้ใน URL (?board=) — สร้างแล้วห้ามแก้
  name             text not null,              -- ชื่อที่ขึ้นบนจอ (= ชื่อชีทเดิม)
  kind             text not null,              -- กลุ่มแท็บ: line | rack | raw | great | vendor
  line_name        text,                       -- ไลน์ที่ผูก → ใช้ดึง IN/OUT/MIN จากระบบอัตโนมัติ
  customer         text,                       -- ลูกค้า/ปลายทาง (rack · great · vendor)
  period_kind      text not null default 'day',-- หน่วยคอลัมน์: day | week | date
  period_count     int  not null default 34,   -- กี่คอลัมน์ (ไฟล์จริง 34-36 วัน ≈ 5 สัปดาห์)
  start_date       date,                       -- คอลัมน์แรก = "ยอดยกมา" · null = ใช้วันทำงานปัจจุบัน
  rows             jsonb not null,             -- ชุดแถว [{key,label,kind,recur}] ← หัวใจของ data-driven
  sl_row           text not null default 'out',        -- Total SL นับจากแถวไหน (ดูหมายเหตุ ⚠️ ล่าง)
  sl_includes_seed boolean not null default false,      -- บวกยอดยกมาเข้า Total SL ด้วยไหม
  sort_order       int,
  is_active        boolean not null default true,
  note             text,
  updated_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists monitor_boards_key_uniq on monitor_boards (board_key);
create index if not exists monitor_boards_kind_idx on monitor_boards (kind, sort_order) where is_active;

-- 🔴 ชุดแถวต้องเป็น array ของ object ที่มี key + kind — jsonb เปล่าจะทำให้จอว่างเงียบ
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'monitor_boards_rows_chk') then
    alter table monitor_boards add constraint monitor_boards_rows_chk
      check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monitor_boards_kind_chk') then
    alter table monitor_boards add constraint monitor_boards_kind_chk
      check (kind in ('line', 'rack', 'raw', 'great', 'vendor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monitor_boards_period_chk') then
    alter table monitor_boards add constraint monitor_boards_period_chk
      check (period_kind in ('day', 'week', 'date') and period_count between 1 and 200);
  end if;
end $$;

comment on table  monitor_boards is 'นิยามบอร์ด Monitoring — 1 แถว = 1 ชีทในไฟล์ Excel ของทีมวางแผน · ชุดแถวอยู่ใน rows (jsonb) ⇒ เพิ่มชีทใหม่ไม่ต้องแก้โค้ด';
comment on column monitor_boards.rows is 'ชุดแถว [{key,label,kind,recur}] · kind: input(คนกรอก) system(ระบบรู้ คนทับได้) recur(คำนวณจากคอลัมน์ก่อน) const(ไหลไปขวา) date(ช่องวันที่) · recur = ชื่อสูตรใน RECUR ของ src/utils/monitorGrid.js';
comment on column monitor_boards.sl_row is '⚠️ ไฟล์จริงคิด Total SL ไม่เหมือนกันระหว่างชีท: 800T นับแถว OUT · 110T นับแถว IN + ยอดยกมา ⇒ เก็บเป็นการตั้งค่า ไม่ยุบให้เหลือสูตรเดียวเอง (จะเปลี่ยนตัวเลขที่ทีมใช้อยู่โดยไม่มีใครสั่ง)';
comment on column monitor_boards.start_date is 'คอลัมน์แรกของบอร์ด = ช่อง "ยอดยกมา" ที่คนต้องใส่ · ไม่ใส่ = ทั้งแถว recur เป็น null (ห้ามเดา 0)';

-- ── 2) พาร์ทบนบอร์ด + หัวตาราง ────────────────────────────────────────────────────────
-- ⚠️ ตั้งใจเก็บ mat_no เป็น text ไม่ผูก FK ไป dr_products — เหมือนทะเบียน master ตัวอื่น
--    (CLAUDE.md: "คอลัมน์ปลายทางเก็บ name/code เป็น text เหมือนเดิม ไม่ผูก FK")
--    เหตุผลจริงที่วัดได้ 01/10: พาร์ทในไฟล์ 106 ตัว **อยู่ใน dr_products แค่ 63 ตัว**
--    ⇒ ผูก FK = เอาไฟล์เข้าระบบไม่ได้ 43 ตัว = ทีมวางแผนกลับไปใช้ Excel ทันที
--    พาร์ทที่ยังไม่มีในทะเบียน ให้ขึ้นบนจอว่า "ยังไม่อยู่ในทะเบียนสินค้า" แล้วค่อยทยอยเก็บ
create table if not exists monitor_board_parts (
  id              uuid primary key default gen_random_uuid(),
  board_id        uuid not null references monitor_boards (id) on delete cascade,
  mat_no          text,                 -- Mat SAP (ว่างได้ — ไฟล์จริงมีแถวที่ยังไม่มีเลข)
  part_no         text,
  part_name       text,
  model           text,
  raw_mat         text,                 -- 110T/300T: คอลัมน์ Raw material
  process         text,                 -- 110T: คอลัมน์ Process
  rack            text,                 -- TSPK/TSESA: ชั้นวาง
  lot_qty         numeric,              -- LOT
  packing         numeric,              -- Packing / P.STD.
  cost            numeric,              -- Cost (บาท/ชิ้น)
  ct_sec          numeric,              -- Time (วินาที/จังหวะ)
  fc              numeric,              -- Forecast ของช่วงนี้
  pieces_per_shot int,                  -- 🔴 งานคู่ gang die — ปั๊มทีเดียวได้กี่ชิ้น (ชิ้น ≠ shot)
  kg_per_piece    numeric,              -- ชีท mat: อัตราใช้เหล็ก กก./ชิ้น
  spec            text,                 -- ชีท mat: สเปคม้วน (Description)
  semi_part       text,                 -- ชีท mat: Semi Part ที่เหล็กม้วนนี้ไปทำ
  sort_order      int,
  is_active       boolean not null default true,
  note            text,
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists monitor_board_parts_board_idx on monitor_board_parts (board_id, sort_order) where is_active;
create index if not exists monitor_board_parts_mat_idx on monitor_board_parts (mat_no) where is_active;

-- กันพาร์ทซ้ำบนบอร์ดเดียวกัน (ไฟล์จริงมีแถวว่างคั่น ⇒ อนุญาต mat_no ว่างได้หลายแถว)
create unique index if not exists monitor_board_parts_uniq
  on monitor_board_parts (board_id, mat_no) where mat_no is not null and is_active;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'monitor_board_parts_pieces_chk') then
    alter table monitor_board_parts add constraint monitor_board_parts_pieces_chk
      check (pieces_per_shot is null or pieces_per_shot between 1 and 20);
  end if;
end $$;

comment on table  monitor_board_parts is 'พาร์ทบนบอร์ด Monitoring + หัวตาราง (LOT/Packing/FC/CT/Cost) · mat_no เป็น text ไม่ผูก FK โดยตั้งใจ — 43 จาก 106 พาร์ทในไฟล์จริงยังไม่อยู่ใน dr_products';
comment on column monitor_board_parts.pieces_per_shot is '🔴 งานคู่ gang die: ปั๊ม 1 จังหวะได้กี่ชิ้น — ใช้แปลงเหล็ก(กก.) ⇄ ชิ้น ในชีท mat (ไฟล์เดิมคนพิมพ์ ×2 / ÷2 มือรายแถว)';
comment on column monitor_board_parts.fc is 'Forecast ของช่วงที่บอร์ดครอบ — ใช้คิด Diff FC / %SL · ไม่ใส่ = ไม่คิด %SL (ห้ามคืน 0)';

-- ── 3) ช่องที่คนกรอก (เก็บเฉพาะช่องที่มีค่า — แถว recur ไม่เคยเก็บ) ───────────────────
-- 🔴 แถวที่คำนวณได้ (UNBOUND/BALANCE/MIN ที่ไหลมา) **ห้ามเก็บลงตารางนี้**
--    เก็บ = มี 2 แหล่งความจริงทันที แล้ววันที่สูตรเปลี่ยน ของเก่าไม่ตามไปด้วย
--    ยกเว้นช่อง "ยอดยกมา" (คอลัมน์แรก) ซึ่งเป็น input จริงๆ ที่คนต้องใส่
create table if not exists monitor_cells (
  id              uuid primary key default gen_random_uuid(),
  board_part_id   uuid not null references monitor_board_parts (id) on delete cascade,
  row_key         text not null,        -- ตรงกับ rows[].key ของบอร์ด
  period_key      date not null,        -- คอลัมน์ (วัน / ต้นสัปดาห์ / วันที่ส่ง)
  qty             numeric,
  txt             text,                 -- แถว kind='date' หรือหมายเหตุในช่อง
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists monitor_cells_uniq on monitor_cells (board_part_id, row_key, period_key);
create index if not exists monitor_cells_period_idx on monitor_cells (period_key);

comment on table  monitor_cells is 'ช่องที่คนกรอกบนบอร์ด Monitoring · เก็บเฉพาะช่องที่มีค่า (sparse) · แถวที่คำนวณได้ห้ามเก็บ — คิดสดจาก src/utils/monitorGrid.js ทุกครั้ง';
comment on column monitor_cells.period_key is 'คอลัมน์ · period_kind=week ⇒ เก็บวันแรกของสัปดาห์ · ⚠️ เป็น date เสมอ ห้ามเก็บเป็น text (เรียง/กรองช่วงไม่ได้)';

-- ── RLS: DR เป็น anon เสมอ (กฎเหล็ก — supabaseDR ไม่เคย authenticate) ────────────────
-- สิทธิ์คุมที่ UI ผ่าน can('monitoring:manage') เหมือนตาราง DR อื่นทั้งหมด
-- 🔴 ห้ามเปลี่ยนเป็น `TO authenticated` — client ไม่มี JWT ให้เช็ค จอจะว่างทั้งหมดทันที
alter table monitor_boards       enable row level security;
alter table monitor_board_parts  enable row level security;
alter table monitor_cells        enable row level security;
do $$
declare t text;
begin
  foreach t in array array['monitor_boards', 'monitor_board_parts', 'monitor_cells'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_all') then
      execute format('create policy %I on %I for all using (true) with check (true)', t || '_all', t);
    end if;
  end loop;
end $$;

-- ── updated_at + audit (pattern เดียวกับ master ตัวอื่นฝั่ง DR) ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['monitor_boards', 'monitor_board_parts', 'monitor_cells'] loop
    if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
      execute format('drop trigger if exists %I on %I', 'trg_' || t || '_updated', t);
      execute format('create trigger %I before update on %I for each row execute function fn_set_updated_at()',
                     'trg_' || t || '_updated', t);
    end if;
    if exists (select 1 from pg_proc where proname = 'fn_audit') then
      execute format('drop trigger if exists %I on %I', 'trg_' || t || '_audit', t);
      execute format('create trigger %I after insert or update or delete on %I for each row execute function fn_audit()',
                     'trg_' || t || '_audit', t);
    end if;
  end loop;
end $$;

-- Rollback:
--   drop table if exists monitor_cells;
--   drop table if exists monitor_board_parts;
--   drop table if exists monitor_boards;
