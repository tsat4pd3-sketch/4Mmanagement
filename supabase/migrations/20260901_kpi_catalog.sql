-- ══ ทะเบียนชื่อ KPI (Main · 2026-09-01 · feedback user) ═════════════════════════
-- "ชื่อ KPI ไม่อยากให้เป็น text ได้เรื่อยๆ อยากให้ดึงค่าจากการกำหนดไว้แล้วมาเลือก
--  เพราะไม่งั้นจะมองเป็นคนละหัวข้อถ้าพิมพ์ผิด" + "ลงย้อนหลังได้มั้ย"
--
-- 2 คำถามนี้รากเดียวกัน: `kpi_definitions` ผูก (year, section) ⇒ จะลงข้อมูลปีก่อน
-- ต้องสร้างนิยามใหม่ทั้งชุด แล้วพิมพ์ชื่อใหม่ทุกครั้ง = ต้นตอของการพิมพ์ผิดจนแตกเป็นคนละ KPI
-- และใบ Monitoring FM-HRM-6-024 ต้องเทียบปีต่อปี — ชื่อ drift เมื่อไหร่ เทียบไม่ได้ทันที
--
-- โครงเดียวกับ parts_master ↔ dr_products ที่โปรเจคใช้อยู่:
--   `kpi_catalog`     = **ตัวตนของ KPI** (ชื่อ/หน่วย/สูตร/ทิศทาง) — ชุดเดียวใช้ข้ามปี ข้ามส่วนงาน
--   `kpi_definitions` = **มุมมองรายปี** (ปีนี้ ส่วนงานนี้ เป้าเท่าไหร่ น้ำหนักเท่าไหร่)
--
-- กติกา:
-- - ชื่อห้ามซ้ำแบบ "ต่างแค่ช่องว่าง/ตัวพิมพ์" → unique index บน lower(btrim(name))
-- - `kpi_definitions.name` **คงไว้** เป็น fallback ของแถวที่ไม่ผูกทะเบียน (backward-compatible)
--   แสดงผล/พิมพ์/export ใช้ชื่อจากทะเบียนก่อนเสมอ ⇒ **แก้ชื่อในทะเบียนแล้วเปลี่ยนทุกปีทุกส่วนงานพร้อมกัน**
-- - ห้าม KPI ตัวเดียวกันซ้ำใน (ปี, ส่วนงาน) เดียวกัน → unique index
-- - **ไม่ seed ชื่อ KPI ใดๆ โดยตั้งใจ** — "ชื่อ KPI ของบริษัท" เป็นความรู้ของ user
--   เดาแล้วใส่ไว้จะสวนทางกับเป้าหมายของงานนี้เอง (หลักเดียวกับ EF พลังงาน / lot_size ที่ห้ามเดา)
-- - สิทธิ์ใช้ `kpi:manage` เดิม ไม่เพิ่ม key ใหม่ (เลี่ยงกับดัก seed enum_range)

create table if not exists public.kpi_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'internal'
    check (category in ('financial','customer','internal','learning')),
  unit text,                            -- '%' · 'บาท' · 'ครั้ง' · 'คน'
  formula_text text,                    -- คอลัมน์ Formula ในชีท Monitoring
  scope_text text,                      -- 'Data from Acc' / 'Data from HRM'
  direction text check (direction in ('up','down')),   -- ทิศทางตั้งต้น (ปีไหนต่างค่อย override)
  decimals int not null default 2,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- กันชื่อซ้ำแบบ "ต่างแค่ช่องว่าง/ตัวพิมพ์" — นี่คือหัวใจของงานนี้
create unique index if not exists kpi_catalog_name_uniq
  on public.kpi_catalog (lower(btrim(name)));

alter table public.kpi_definitions
  add column if not exists catalog_id uuid references public.kpi_catalog(id) on delete set null;
create index if not exists idx_kpi_definitions_catalog on public.kpi_definitions (catalog_id);

-- KPI ตัวเดียวกันห้ามซ้ำในปี+ส่วนงานเดียวกัน (section null = ส่วนกลาง)
create unique index if not exists kpi_definitions_year_section_catalog_uniq
  on public.kpi_definitions (year, coalesce(section, ''), catalog_id)
  where catalog_id is not null;

alter table public.kpi_catalog enable row level security;
drop policy if exists kpi_catalog_read on public.kpi_catalog;
create policy kpi_catalog_read on public.kpi_catalog
  for select to authenticated using (true);
drop policy if exists kpi_catalog_write on public.kpi_catalog;
create policy kpi_catalog_write on public.kpi_catalog
  for all to authenticated
  using (public.has_perm('kpi:manage'))
  with check (public.has_perm('kpi:manage'));

drop trigger if exists trg_kpi_catalog_audit on public.kpi_catalog;
create trigger trg_kpi_catalog_audit after insert or update or delete on public.kpi_catalog
  for each row execute function public.fn_audit();
drop trigger if exists trg_kpi_catalog_updated on public.kpi_catalog;
create trigger trg_kpi_catalog_updated before update on public.kpi_catalog
  for each row execute function public.fn_set_updated_at();
