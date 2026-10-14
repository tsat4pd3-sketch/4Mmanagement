-- 🗑️ เก็บกวาดตารางที่ไม่มีใครใช้ 12 ตัว (Main · ewhdfqwfwofivojtsizn) — คำสั่ง user 2026-10-14
-- ⚠️ ไฟล์นี้ **user รันเองใน Supabase SQL Editor** — MCP รัน `drop` ไม่ได้ (ค้าง 60 วิ
--    เพราะถูกตีว่าเป็นคำสั่งทำลาย · 📄 docs/modules/db-write-rules.md §ขอบเขตของ MCP Supabase)
--
-- ✅ ตรวจก่อนลบแล้ว (วัดสด 14/10): **ไม่มี view · ไม่มี function · ไม่มี realtime publication**
--    ไหนอ้างถึงทั้ง 12 ตัว · FK ผูกกันเองในกลุ่ม 3 เส้นเท่านั้น (ppe_checks→ppe_items,attendances ·
--    ppe_requirements→ppe_items) ⇒ เรียงลำดับลูกก่อนแม่ **ไม่ต้องใช้ CASCADE**
--    trigger ที่ติดอยู่มีแค่ `trg_audit`/`trg_set_updated_at` (หายไปพร้อมตารางเอง)
--
-- 🔀 แยก 2 วิธีตามว่ามีข้อมูลหรือไม่ — **ไม่ใช่การลดสเกลงาน** ทั้ง 12 ตัวหายจากแอปเท่ากัน
--    ต่างกันแค่ "กู้คืนได้ไหมถ้าคิดผิด":
--    · 6 ตัวว่าง (0 แถว)      → `drop` จริง (ไม่มีอะไรจะเสีย · นิยามคอลัมน์เก็บไว้ท้ายไฟล์นี้)
--    · 6 ตัวมีข้อมูล 386 แถว → ย้ายเข้า schema `archive` (ตามกฎโปรเจคเอง §/schema)
--      — `archive` **ไม่ถูก expose ผ่าน API และ anon/authenticated ไม่มี USAGE** (วัดแล้ว)
--      ⇒ หายจากแอป · หายจากหน้า `/schema` · ไม่มีหน้า RLS ให้ยิง แต่ข้อมูลยังอยู่
--      ⇒ จะลบทิ้งจริงทีหลัง = `drop schema archive cascade;` บรรทัดเดียว (ดูท้ายไฟล์)

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 1 — ตารางว่าง 6 ตัว: ลบจริง (เรียงลูกก่อนแม่)
-- ════════════════════════════════════════════════════════════════════════════
drop table if exists public.ppe_checks;          -- 0 แถว · FK → ppe_items, attendances (ลบก่อน)
drop table if exists public.ppe_requirements;    -- 0 แถว · FK → ppe_items (ลบก่อน)
drop table if exists public.attendances;         -- 0 แถว · ไม่มีโค้ดไหนอ้างถึง (เสนอลบตั้งแต่รอบ 7)
drop table if exists public.kpi_section_detail;  -- 0 แถว · KPI รุ่นเก่า เลิกใช้ 25/05
drop table if exists public.production_shots;    -- 0 แถว · โครงเตรียมรับ SCADA ที่ยังไม่เปิดใช้
drop table if exists public.profile_org_access;  -- 0 แถว · ไม่มีโค้ดไหนอ้างถึง (เสนอลบตั้งแต่รอบ 5)

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 2 — 6 ตัวที่มีข้อมูล: ย้ายเข้า archive (ตั้งชื่อ <ตาราง>_unused_<YYYYMMDD>)
-- ════════════════════════════════════════════════════════════════════════════
create schema if not exists archive;

alter table public.ppe_items          set schema archive;   -- 10 แถว
alter table archive.ppe_items         rename to ppe_items_unused_20261014;

alter table public.part_registry      set schema archive;   -- 4 แถว (คนละตัวกับคีย์ cache 'part_registry:main')
alter table archive.part_registry     rename to part_registry_unused_20261014;

alter table public.part_images        set schema archive;   -- 4 แถว (คนละตัวกับคีย์ cache 'part_images:v1')
alter table archive.part_images       rename to part_images_unused_20261014;

alter table public.kpi_actuals        set schema archive;   -- 44 แถว · KPI รุ่นเก่า
alter table archive.kpi_actuals       rename to kpi_actuals_unused_20261014;

alter table public.kpi_targets        set schema archive;   -- 313 แถว · KPI รุ่นเก่า (ก้อนใหญ่สุด)
alter table archive.kpi_targets       rename to kpi_targets_unused_20261014;

alter table public.kpi_raw_inputs     set schema archive;   -- 11 แถว · KPI รุ่นเก่า
alter table archive.kpi_raw_inputs    rename to kpi_raw_inputs_unused_20261014;

-- ════════════════════════════════════════════════════════════════════════════
-- คิวรีเช็คผล (รันต่อท้ายได้เลย — ต้องได้ 0 ทุกบรรทัด ยกเว้นบรรทัดสุดท้าย)
-- ════════════════════════════════════════════════════════════════════════════
-- select count(*) as ต้องเหลือ_0 from information_schema.tables
--  where table_schema='public' and table_name in
--   ('ppe_items','ppe_requirements','ppe_checks','part_registry','part_images','attendances',
--    'profile_org_access','production_shots','kpi_actuals','kpi_targets','kpi_raw_inputs','kpi_section_detail');
--
-- select table_name, (select count(*) from information_schema.columns c
--                     where c.table_schema='archive' and c.table_name=t.table_name) as n_cols
--   from information_schema.tables t where table_schema='archive' and table_name like '%_unused_20261014'
--   order by table_name;   -- ต้องได้ 6 แถว
--
-- select (select count(*) from archive.kpi_targets_unused_20261014) as kpi_targets_ยังอยู่_313;

-- ════════════════════════════════════════════════════════════════════════════
-- 🔁 ย้อนกลับ
-- ════════════════════════════════════════════════════════════════════════════
-- (ก) เอา 6 ตัวที่มีข้อมูลกลับเข้า public (ข้อมูลครบเหมือนเดิม):
--   alter table archive.ppe_items_unused_20261014      rename to ppe_items;
--   alter table archive.ppe_items                      set schema public;
--   -- (ทำซ้ำแบบเดียวกันกับ part_registry · part_images · kpi_actuals · kpi_targets · kpi_raw_inputs)
--   🔴 RLS policy เดิมติดไปกับตารางด้วย ⇒ ย้ายกลับมาแล้วได้ policy ชุดเดิมเลย ไม่ต้องสร้างใหม่
--
-- (ข) 6 ตัวที่ว่างและถูก drop — สร้างคืนจากนิยามนี้ (ดึงสดจาก pg_catalog ก่อนลบ 14/10)
--     ⚠️ สร้างคืนแล้ว **ต้องใส่ RLS + policy has_perm เอง** (ของเดิมหายไปกับตาราง)
--
-- create table public.attendances (
--   id serial primary key, employee_uuid uuid not null,
--   date date not null default CURRENT_DATE,
--   check_in_time timestamptz not null default now(),
--   status varchar(10) not null default 'present');
--
-- create table public.ppe_checks (
--   id serial primary key, attendance_id integer not null, ppe_item_id integer not null,
--   is_wearing boolean not null default false);
--
-- create table public.ppe_requirements (
--   id serial primary key, line_id integer not null, ppe_item_id integer not null,
--   is_mandatory boolean not null default true, updated_at timestamptz default now());
--
-- create table public.kpi_section_detail (
--   id uuid primary key default gen_random_uuid(), kpi_item_id uuid,
--   year integer not null, month integer not null, section text not null, sub_label text not null,
--   actual_value numeric, note text,
--   created_at timestamptz default now(), updated_at timestamptz default now());
--
-- create table public.profile_org_access (
--   id uuid primary key default gen_random_uuid(), profile_id uuid not null,
--   section text, line_id integer, team text, created_at timestamptz default now());
--
-- -- 🔴 ตัวนี้เป็น "โครงออกแบบไว้รอ SCADA" (downtime แยก 7 หมวด) — เก็บนิยามไว้ครบ
-- --    เพราะเป็นงานออกแบบ ไม่ใช่ตารางที่เผลอสร้าง · ฝั่ง DR มี production_shots อีกตัว
-- --    คนละโครงสร้าง (machine_no + shot_count) **ไฟล์นี้ไม่แตะฝั่ง DR**
-- create table public.production_shots (
--   id uuid primary key default gen_random_uuid(),
--   production_date date not null, shift text not null, line_name text not null,
--   start_time time, end_time time, total_shots integer not null default 0,
--   defect_rh integer default 0, defect_lh integer default 0,
--   downtime_main_machine integer default 0, downtime_sub_machine integer default 0,
--   downtime_robot integer default 0, downtime_plc_sensor integer default 0,
--   downtime_mold_jig integer default 0, downtime_quality integer default 0,
--   downtime_waiting_container integer default 0, downtime_waiting_qa integer default 0,
--   source text default 'webapp', created_at timestamptz default now());
--
-- (ค) ลบ archive ทิ้งจริงทั้งหมด (กู้ไม่ได้อีก) — ทำเมื่อมั่นใจแล้วเท่านั้น:
--   🔴 `drop schema archive cascade;` จะลบ **ทั้ง 21 ตาราง** ใน archive (15 ตัวเดิม + 6 ตัวนี้)
--      ถ้าอยากลบแค่ 6 ตัวนี้: drop table archive.<ชื่อ>_unused_20261014; ทีละตัว
-- ════════════════════════════════════════════════════════════════════════════
