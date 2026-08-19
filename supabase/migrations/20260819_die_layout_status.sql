-- 🔨 DIE MAINTENANCE — Layout แม่พิมพ์ + ติดตามสถานะแม่พิมพ์ (DR project · 2026-08-19)
--
-- โจทย์: ทีม DIE MTN ต้องตอบได้ว่า "แม่พิมพ์ตัวนี้อยู่ตรงไหน · สถานะอะไร"
--   (1) ผังจัดเก็บ: รูปจริงของคลัง/พื้นที่วางแม่พิมพ์ + หมุดตำแหน่งรายตัว
--       — pattern เดียวกับ mtn_rack_maps (RackMap): รูป 1 รูป + พิกัดเป็น % ของรูป (0-100)
--   (2) สถานะ: แกน manual (die_status — พร้อมใช้/ติดตั้งบนเครื่อง/ซ่อมภายใน/ส่งภายนอก/Try-out/เลิกใช้)
--       + แกน derive จากใบซ่อม MO จริง (mtn_orders ที่ยังไม่ปิด — คำนวณสดในแอป **ไม่เก็บซ้ำใน DB**)
--
-- ⚠️ หลักการเดิมของทะเบียนแม่พิมพ์ (20260810_equipment_kind_and_die_master.sql):
--    ตัวตนแม่พิมพ์อยู่ `machines` (equipment_kind='die') — ตำแหน่ง/สถานะเป็น "รายละเอียดเฉพาะชนิด"
--    จึงลงที่ส่วนขยาย `equipment_die` (1:1) **ห้ามยัดคอลัมน์เฉพาะชนิดลง machines**
--
-- ⚠️ ค่า die_status เป็น key ล้วน — ชื่อ/สี/ความหมาย source of truth อยู่ `src/utils/dieStatus.js`
--    (ไม่ใส่ check constraint เพื่อให้เพิ่มสถานะใหม่ในโค้ดได้โดยไม่ต้อง migration —
--     key ที่โค้ดไม่รู้จักจะแสดงเป็นสีเทาพร้อม key ดิบ ไม่หายเงียบ)
--    null = "ยังไม่ระบุสถานะ" โดยตั้งใจ — ห้าม default เป็น ready (จะกลายเป็นเดาแทนหน้างาน
--     ว่าแม่พิมพ์ 262 ตัวพร้อมใช้ทั้งที่ไม่มีใครยืนยัน · หลักเดียวกับ backfill ที่ปล่อยช่องว่าง)

-- ── 1) ผังพื้นที่จัดเก็บแม่พิมพ์ (หลายผังได้: คลังหลัก/ข้างไลน์/ชั้นวาง) ──────────
-- ⚠️ ต้องมี updated_by_name เพราะจะอยู่ใน DR_AUDIT_TABLES (supabaseClient.js stamp ให้อัตโนมัติ)
create table if not exists die_storage_areas (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  image_url       text,
  note            text,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table die_storage_areas is
  'ผังพื้นที่จัดเก็บแม่พิมพ์ (DIE MTN) — รูปจริง + หมุดตำแหน่งแม่พิมพ์เป็น % ของรูป (equipment_die.area_id/pos_x/pos_y)';

alter table die_storage_areas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='die_storage_areas' and policyname='die_storage_areas_all') then
    create policy die_storage_areas_all on die_storage_areas for all using (true) with check (true);
  end if;
end $$;

-- ── 2) ตำแหน่ง + สถานะ บนส่วนขยายแม่พิมพ์ (equipment_die 1:1 กับ machines) ────────
alter table equipment_die add column if not exists area_id uuid references die_storage_areas(id) on delete set null;
alter table equipment_die add column if not exists pos_x numeric;   -- % ของรูปผัง 0-100
alter table equipment_die add column if not exists pos_y numeric;
alter table equipment_die add column if not exists die_status text; -- key — ดู src/utils/dieStatus.js · null = ยังไม่ระบุ
alter table equipment_die add column if not exists status_note text;
alter table equipment_die add column if not exists status_updated_at timestamptz;
alter table equipment_die add column if not exists status_updated_by_name text;

create index if not exists equipment_die_area_idx on equipment_die (area_id);

comment on column equipment_die.area_id is
  'ผังจัดเก็บที่แม่พิมพ์ถูกวางหมุดไว้ — null = ยังไม่ได้วางบนผังไหน (worklist ในหน้า /die-registry ห้ามซ่อน)';
comment on column equipment_die.die_status is
  'สถานะ manual ของแม่พิมพ์ (key) — สถานะ "มีใบซ่อมค้าง" ไม่เก็บที่นี่ derive สดจาก mtn_orders เสมอ กัน 2 แหล่ง drift กัน';

-- ── 3) audit + updated_at ให้ตารางผังใหม่ (guard แบบเดียวกับ migration เดิม) ─────
do $$ begin
  if exists (select 1 from pg_proc where proname='fn_set_updated_at') then
    drop trigger if exists trg_die_storage_areas_updated on die_storage_areas;
    create trigger trg_die_storage_areas_updated before update on die_storage_areas
      for each row execute function fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname='fn_audit') then
    drop trigger if exists trg_die_storage_areas_audit on die_storage_areas;
    create trigger trg_die_storage_areas_audit after insert or update or delete on die_storage_areas
      for each row execute function fn_audit();
  end if;
end $$;
