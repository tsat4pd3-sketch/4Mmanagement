-- ══════════════════════════════════════════════════════════════════════════════════════════
-- KPI: ขอบเขตหลายระดับ + ลิ้งที่มาข้อมูล + แผนรายเดือน + ตัวแปรฐาน   (Main · 2026-09-16)
-- ที่มา: user ส่งใบจริง 3 แผนก (PD3 · PD4 · JIG MTN) + คู่มือ KPI Online ของกลุ่ม
--        → docs/OBEYA-KPI-SOURCES.md §8-12 (อ่านก่อนแก้ไฟล์นี้)
--
-- ทำไมต้องขยาย (สิ่งที่ใบจริงพิสูจน์แล้ว — hardcode ไม่มีทางพอ):
--   1) **แต่ละแผนกใช้ KPI คนละชุด** — JIG MTN ไม่มี Inventory/PPM/OEE แต่มี MTBF/MTTR/PM JIG
--   2) **ขอบเขตไม่ใช่แกนเดียว** — KPI การเงินตัดด้วย *cost center* (2140662101) · KPI ผลิตตัดด้วย *ไลน์*
--      1 กลุ่มไลน์ครอบหลาย cc และหลายไลน์ใช้ cc เดียวกัน ⇒ เก็บเป็น (scope_kind, scope_value)
--      ไม่ใช่คอลัมน์ section/line_group ตายตัว   (user 16/09: "เจาะได้ตามระดับ ส่วน·แผนก·กลุ่ม·ไลน์ลูก")
--   3) **Commitment กับ Target เป็นคนละบาร์** และเกณฑ์คะแนนทางการคือ
--      ถึง Target = weight×1 · ถึง Commitment = ×0.5 · ไม่ถึง = 0   ⇒ ต้องเก็บเครื่องหมาย+ตัวเลขแยก
--   4) **แผนรายเดือนไม่เท่ากันทุกเดือน** (DL/OH/TS Academy) ปนกับแบบค่าคงที่ ⇒ ต้องมีแผน 12 ค่า
--   5) **ตัวเลขการเงินคำนวณจาก "ตัวแปรฐาน"** ที่บัญชีกรอกเดือนละครั้ง (Actual DL ÷ Sale from product)
--      ไม่ใช่ผลลัพธ์ที่คนพิมพ์เข้ามาเอง ⇒ ตาราง kpi_base_inputs
--
-- ⚠️ backward-compatible ทั้งหมด: คอลัมน์ใหม่ nullable · ตารางใหม่ล้วน ·
--    `section`/`line_group` เดิมยังใช้ได้ (trigger sync 2 ทางกับ scope_kind/scope_value)
--    โค้ดเดิมที่ insert ด้วย section/line_group อย่างเดียว ทำงานได้เหมือนเดิมไม่ต้องแก้
-- 📊 ตอนรัน: kpi_definitions = 0 แถว · kpi_manual_entries = 0 แถว ⇒ blast radius เป็นศูนย์
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1) kpi_definitions: ขอบเขต · commit/target แยกช่อง · ลิ้ง data · ข้อย่อย ─────────────
alter table public.kpi_definitions
  add column if not exists scope_kind      text,      -- section|department|line_group|line|cost_center|plant
  add column if not exists scope_value     text,      -- ค่าของระดับนั้น (ชื่อส่วนงาน/แผนก/ไลน์/เลข cc)
  add column if not exists commit_compare  text,      -- <= >= < >   (คู่กับ commit_value)
  add column if not exists commit_value    numeric,
  add column if not exists target_compare  text,      -- <= >= < >   (คู่กับ target_value ที่มีอยู่แล้ว)
  add column if not exists unit            text,      -- override หน่วยจาก kpi_catalog (ใบต่างแผนกใช้คนละหน่วยได้)
  add column if not exists provider        text,      -- 🔗 ลิ้ง data — ดู src/utils/kpiSetup.js (KPI_PROVIDERS)
  add column if not exists provider_config jsonb,     -- พารามิเตอร์ของ provider (เช่น สูตร/ตัวแปรฐานที่ใช้)
  add column if not exists champion        text,      -- ผู้รับผิดชอบรายแถว (ใบจริงมีช่องนี้)
  add column if not exists seq_label       text,      -- เลขข้อที่โชว์ เช่น '1.2a' (seq เป็น integer เรียงอย่างเดียว)
  add column if not exists parent_id       uuid;      -- ข้อย่อยใต้ข้อแม่ (1.2a/1.2b ใต้ 1.2)

do $$ begin
  alter table public.kpi_definitions
    add constraint kpi_definitions_parent_fk foreign key (parent_id)
    references public.kpi_definitions(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.kpi_definitions add constraint kpi_definitions_scope_kind_chk
    check (scope_kind is null or scope_kind in
      ('plant','section','department','line_group','line','cost_center'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.kpi_definitions add constraint kpi_definitions_cmp_chk
    check ((commit_compare is null or commit_compare in ('<=','>=','<','>','='))
       and (target_compare is null or target_compare in ('<=','>=','<','>','=')));
exception when duplicate_object then null; end $$;

-- ── 2) backfill: ขอบเขตเดิม → scope · ข้อความ commitment/target → เครื่องหมาย+ตัวเลข ─────
update public.kpi_definitions
set scope_kind = case when coalesce(line_group,'') <> '' then 'line_group'
                      when coalesce(section,'')    <> '' then 'section'
                      else 'plant' end,
    scope_value = case when coalesce(line_group,'') <> '' then line_group
                       when coalesce(section,'')    <> '' then section
                       else null end
where scope_kind is null;

-- แกะ "≤ 2.5364%" / "<=300PPM" / "≥ 95%" → compare + ตัวเลข (เก็บหน่วยไว้ที่ unit เหมือนเดิม)
-- หมายเหตุ: ≤/≥ (U+2264/U+2265) ที่ใบไทยใช้ ถูกแปลงเป็น <=/>= ให้ด้วย
create or replace function public._kpi_cmp(txt text)
returns text language sql immutable as $$
  select case
    when txt is null then null
    when txt ~ '(≤|<=)' then '<='
    when txt ~ '(≥|>=)' then '>='
    when txt ~ '<'      then '<'
    when txt ~ '>'      then '>'
    else null end;
$$;

create or replace function public._kpi_num(txt text)
returns numeric language plpgsql immutable as $$
declare m text;
begin
  if txt is null then return null; end if;
  m := (regexp_match(replace(txt, ',', ''), '(-?[0-9]+(\.[0-9]+)?)'))[1];
  if m is null then return null; end if;
  return m::numeric;
end; $$;

update public.kpi_definitions
set commit_compare = coalesce(commit_compare, public._kpi_cmp(commitment)),
    commit_value   = coalesce(commit_value,   public._kpi_num(commitment)),
    target_compare = coalesce(target_compare, public._kpi_cmp(target)),
    target_value   = coalesce(target_value,   public._kpi_num(target))
where commitment is not null or target is not null;

-- ── 3) trigger sync 2 ทาง — โค้ดเดิมที่รู้จักแค่ section/line_group ยังทำงานได้ ─────────────
create or replace function public.fn_kpi_def_scope_sync()
returns trigger language plpgsql as $$
begin
  -- ก) ฝั่งเก่า → ใหม่: ไม่ได้ส่ง scope มา ให้เดาจาก section/line_group
  if new.scope_kind is null then
    if coalesce(new.line_group,'') <> '' then
      new.scope_kind := 'line_group'; new.scope_value := new.line_group;
    elsif coalesce(new.section,'') <> '' then
      new.scope_kind := 'section';    new.scope_value := new.section;
    else
      new.scope_kind := 'plant';      new.scope_value := null;
    end if;
  end if;

  -- ข) ใหม่ → เก่า: mirror กลับเฉพาะ 2 ระดับที่คอลัมน์เดิมแทนได้จริง
  --    ระดับอื่น (department/line/cost_center) ปล่อย line_group เป็น null —
  --    **ห้าม mirror ลง line_group** เพราะจอเก่าจะอ่านว่าเป็นกลุ่มไลน์แล้วกรองผิด
  if new.scope_kind = 'line_group' then
    new.line_group := new.scope_value;
  elsif new.scope_kind = 'section' then
    new.section := coalesce(new.section, new.scope_value);
    new.line_group := null;
  elsif new.scope_kind = 'plant' then
    new.line_group := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_kpi_def_scope_sync on public.kpi_definitions;
create trigger trg_kpi_def_scope_sync
  before insert or update on public.kpi_definitions
  for each row execute function public.fn_kpi_def_scope_sync();

-- ── 4) unique ตามขอบเขตใหม่ (ของเดิมกันซ้ำระดับ section/line_group เท่านั้น — จะบล็อก
--       KPI ตัวเดียวกันคนละไลน์/คนละ cost center ที่อยู่ส่วนงานเดียวกัน) ──────────────────
drop index if exists public.kpi_definitions_year_scope_catalog_uniq;
drop index if exists public.kpi_definitions_year_scope_source_uniq;

create unique index if not exists kpi_definitions_year_scope_catalog_uniq
  on public.kpi_definitions (year, coalesce(scope_kind,''), coalesce(scope_value,''), catalog_id)
  where catalog_id is not null;

create unique index if not exists kpi_definitions_year_scope_source_uniq
  on public.kpi_definitions (year, coalesce(scope_kind,''), coalesce(scope_value,''), source)
  where source is not null;

create index if not exists idx_kpi_definitions_scope
  on public.kpi_definitions (year, scope_kind, scope_value);
create index if not exists idx_kpi_definitions_parent
  on public.kpi_definitions (parent_id) where parent_id is not null;

-- ── 5) แผนรายเดือน 12 ค่า — แยกตารางจาก kpi_manual_entries (= Actual) โดยตั้งใจ ──────────
--     เพราะ upsert ของจอเดิมผูกกับ unique(kpi_id, month) การเติม kind เข้าไปจะทำให้ onConflict เดิมพัง
create table if not exists public.kpi_month_plans (
  id          uuid primary key default gen_random_uuid(),
  kpi_id      uuid not null references public.kpi_definitions(id) on delete cascade,
  month       int  not null check (month between 1 and 12),
  plan_value  numeric,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (kpi_id, month)
);
alter table public.kpi_month_plans enable row level security;
do $$ begin
  create policy kpi_month_plans_read  on public.kpi_month_plans for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy kpi_month_plans_write on public.kpi_month_plans for all
    using (has_perm('kpi:manage')) with check (has_perm('kpi:manage'));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_kpi_month_plans_updated on public.kpi_month_plans;
create trigger trg_kpi_month_plans_updated before update on public.kpi_month_plans
  for each row execute function public.fn_set_updated_at();

-- ── 6) ตัวแปรฐานรายเดือน — หัวใจที่ทำให้ KPI การเงินคำนวณเองได้ ──────────────────────────
--     ใบจริงคำนวณ DL/OH/%RM/100P/Inventory/Sales-per-Head จากตัวเลขดิบไม่กี่ตัวที่บัญชีให้มา
--     (ในไฟล์ Excel คือแถว 48-67 ที่ลิงก์ข้ามไฟล์จนสอบกลับไม่ได้ — ย้ายเข้าระบบให้สอบกลับได้)
--     ⚠️ รายชื่อ var_key อยู่ที่ src/utils/kpiSetup.js (KPI_BASE_VARS) — **ตั้งใจไม่มี check constraint**
--        เพิ่มตัวแปรใหม่ไม่ต้องทำ migration (กติกาเดียวกับ meeting_action_items.kpi_key)
create table if not exists public.kpi_base_inputs (
  id             uuid primary key default gen_random_uuid(),
  year           int  not null,
  month          int  not null check (month between 1 and 12),
  scope_kind     text not null,
  scope_value    text,
  var_key        text not null,
  value          numeric,
  note           text,
  created_by     uuid,
  created_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- ⚠️ UNIQUE ระดับ table ใส่ expression ไม่ได้ (scope_value เป็น null ได้) → ต้องเป็น unique index
create unique index if not exists kpi_base_inputs_uniq
  on public.kpi_base_inputs (year, month, scope_kind, coalesce(scope_value,''), var_key);
alter table public.kpi_base_inputs enable row level security;
do $$ begin
  create policy kpi_base_inputs_read  on public.kpi_base_inputs for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy kpi_base_inputs_write on public.kpi_base_inputs for all
    using (has_perm('kpi:manage')) with check (has_perm('kpi:manage'));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_kpi_base_inputs_updated on public.kpi_base_inputs;
create trigger trg_kpi_base_inputs_updated before update on public.kpi_base_inputs
  for each row execute function public.fn_set_updated_at();
create index if not exists idx_kpi_base_inputs_lookup
  on public.kpi_base_inputs (year, scope_kind, scope_value, var_key);

-- ── ตรวจผลหลังรัน ──────────────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--  where table_name='kpi_definitions' and column_name in
--        ('scope_kind','scope_value','commit_compare','commit_value','target_compare',
--         'unit','provider','provider_config','champion','seq_label','parent_id');
-- select count(*) from kpi_month_plans; select count(*) from kpi_base_inputs;

-- ══════════════════════════════ ROLLBACK ══════════════════════════════════════════════════
-- drop trigger if exists trg_kpi_def_scope_sync on public.kpi_definitions;
-- drop function if exists public.fn_kpi_def_scope_sync();
-- drop index if exists public.kpi_definitions_year_scope_catalog_uniq;
-- drop index if exists public.kpi_definitions_year_scope_source_uniq;
-- create unique index kpi_definitions_year_scope_catalog_uniq on public.kpi_definitions
--   (year, coalesce(section,''), coalesce(line_group,''), catalog_id) where catalog_id is not null;
-- create unique index kpi_definitions_year_scope_source_uniq on public.kpi_definitions
--   (year, coalesce(section,''), coalesce(line_group,''), source) where source is not null;
-- drop table if exists public.kpi_base_inputs;
-- drop table if exists public.kpi_month_plans;
-- alter table public.kpi_definitions
--   drop column if exists scope_kind, drop column if exists scope_value,
--   drop column if exists commit_compare, drop column if exists commit_value,
--   drop column if exists target_compare, drop column if exists unit,
--   drop column if exists provider, drop column if exists provider_config,
--   drop column if exists champion, drop column if exists seq_label, drop column if exists parent_id;
-- drop function if exists public._kpi_cmp(text); drop function if exists public._kpi_num(text);
-- (คอลัมน์ใหม่ nullable ทั้งหมด — ปล่อยไว้ก็ได้ ไม่มีอะไรบังคับใช้)
