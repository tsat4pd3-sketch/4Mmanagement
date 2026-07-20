-- ── Main project (ewhdfqwfwofivojtsizn) — 2026-07-16 ──
-- ผังรวมโรงงาน (factory master map) — รูปผังใหญ่ของทั้งโรงงาน 1 รูป + รูปทรงอิสระ (polygon) ต่อไลน์
-- ใช้แสดง "สถานะการผลิตของทุกไลน์บนผังเดียว" (หน้า /factory-map — เหมาะกับจอ TV)
-- polygon รองรับไลน์รูป L / U shape (ไม่ใช่แค่สี่เหลี่ยม)
-- รูปเก็บใน bucket employee-photos path factory/ (cleanup-orphan-photos whitelist factory_map.image_url แล้ว)
create table if not exists public.factory_map (
  id uuid primary key default gen_random_uuid(),
  image_url text,
  updated_at timestamptz default now()
);
-- points = [[x,y],[x,y],...] เป็น % ของรูปจริง (0-100) วนรอบ polygon
create table if not exists public.factory_line_regions (
  id uuid primary key default gen_random_uuid(),
  line_name text unique not null,
  points jsonb not null,
  created_at timestamptz default now()
);
alter table public.factory_map enable row level security;
alter table public.factory_line_regions enable row level security;
-- อ่านได้ทุกคนที่ login (รวม role display บนจอ TV) · เขียนผ่าน client ที่ login แล้ว (แอป gate ด้วย permission factory_map:edit)
drop policy if exists factory_map_read on public.factory_map;
drop policy if exists factory_map_write on public.factory_map;
drop policy if exists factory_regions_read on public.factory_line_regions;
drop policy if exists factory_regions_write on public.factory_line_regions;
create policy factory_map_read     on public.factory_map          for select to authenticated using (true);
create policy factory_map_write    on public.factory_map          for all    to authenticated using (true) with check (true);
create policy factory_regions_read on public.factory_line_regions for select to authenticated using (true);
create policy factory_regions_write on public.factory_line_regions for all   to authenticated using (true) with check (true);
