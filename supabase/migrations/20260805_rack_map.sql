-- ผังคลังอะไหล่ (Rack Map) — "digital twin" ของชั้นวาง มุมมองด้านหน้า (front view)
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-05
--
-- แนวคิดเดียวกับ factory_line_regions / pm_facility_points / transport_nodes:
--   รูปจริง 1 รูป + พิกัดเป็น % ของรูป (0-100) → ไม่ผูกกับขนาดจอ/ขนาดไฟล์
-- ต่างกันที่ FactoryMap ใช้ polygon (ไลน์รูป L/U) — ชั้นวางเป็นตารางสี่เหลี่ยม
--   จึงเก็บเป็น rect (x,y,w,h) + มีตัวสร้างตารางอัตโนมัติ (แถว × คอลัมน์) ให้ไม่ต้องลากทีละช่อง
--
-- กุญแจจับคู่ของ = `shelf_code` ตรงกับ `mtn_spare_parts.shelf` (text)
--   ไม่ใช้ FK เพราะ 1 ช่องมีอะไหล่ได้หลายตัว และอะไหล่อาจยังไม่ระบุชั้นวาง
--   → รหัสชั้นวางต้อง "นิ่ง" (ฟอร์มอะไหล่มี datalist ช่วย) ไม่งั้นผังจับคู่ไม่เจอ

create table if not exists mtn_rack_maps (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                    -- เช่น "ชั้นวาง A (ห้องอะไหล่ JIG)"
  team            text not null default 'maintenance',  -- mtn_teams.key — คลังใครคลังมัน
  image_url       text,                             -- รูปหน้าตรงของชั้นวาง
  note            text,
  sort_order      int  not null default 0,
  is_active       bool not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz default now(),
  updated_by_name text
);

create table if not exists mtn_rack_cells (
  id              uuid primary key default gen_random_uuid(),
  rack_id         uuid not null references mtn_rack_maps(id) on delete cascade,
  shelf_code      text not null,                    -- = mtn_spare_parts.shelf
  label           text,                             -- ป้ายที่โชว์บนช่อง (ไม่ตั้ง = shelf_code)
  x               numeric not null,                 -- % จากซ้าย (0-100)
  y               numeric not null,                 -- % จากบน (0-100)
  w               numeric not null,                 -- % ความกว้าง
  h               numeric not null,                 -- % ความสูง
  created_at      timestamptz not null default now(),
  updated_at      timestamptz default now(),
  updated_by_name text,
  unique (rack_id, shelf_code)                      -- 1 รหัสชั้นวาง = 1 ช่องต่อผัง (กันวางซ้ำ)
);
create index if not exists mtn_rack_cells_rack_idx  on mtn_rack_cells (rack_id);
create index if not exists mtn_rack_cells_shelf_idx on mtn_rack_cells (shelf_code);

-- RLS: ฝั่ง DR เป็น anon เสมอ (กฎเหล็ก supabaseDR ใน CLAUDE.md) — allow-all ตาม convention
alter table mtn_rack_maps  enable row level security;
alter table mtn_rack_cells enable row level security;
do $$ begin
  create policy mtn_rack_maps_all on mtn_rack_maps for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mtn_rack_cells_all on mtn_rack_cells for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- updated_at + audit (กฎ Traceability: master ที่แก้ไขได้ต้องมี audit)
drop trigger if exists trg_mtn_rack_maps_updated on mtn_rack_maps;
create trigger trg_mtn_rack_maps_updated before update on mtn_rack_maps
  for each row execute function fn_set_updated_at();
drop trigger if exists trg_mtn_rack_cells_updated on mtn_rack_cells;
create trigger trg_mtn_rack_cells_updated before update on mtn_rack_cells
  for each row execute function fn_set_updated_at();

drop trigger if exists trg_audit on mtn_rack_maps;
create trigger trg_audit after insert or update or delete on mtn_rack_maps
  for each row execute function fn_audit();
drop trigger if exists trg_audit on mtn_rack_cells;
create trigger trg_audit after insert or update or delete on mtn_rack_cells
  for each row execute function fn_audit();

-- Rollback: drop table mtn_rack_cells; drop table mtn_rack_maps;
