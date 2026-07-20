-- ผังภาพรวมบริษัท (org map) — วาง node ไลน์บนผัง Facility (2026-07-16)
-- Project: DR/Product (eyhclzkifitbhbljgoav) — client `supabaseDR` (role anon เสมอ)
--
-- MTN วาง "node ไลน์" ทับผัง facility ที่มีอยู่ (pm_facility_areas.image_path)
-- แต่ละ node กระพริบ/เปลี่ยนสีตาม andon 2 ระดับ:
--   🔴 breakdown (เรียกช่างด่วน) = มีใบซ่อม MO ค้าง → กระพริบแดง
--   🟡 planned PM ใกล้ถึงรอบ = PM due/overdue ในไลน์ → เหลืองนิ่ง
-- คลิก node → ไปผังเครื่องของไลน์นั้น (view production)
--
-- anon-open ตาม convention ฝั่ง DR
create table if not exists public.pm_org_nodes (
  id uuid primary key default gen_random_uuid(),
  area_id uuid references public.pm_facility_areas(id) on delete cascade,
  line_name text not null,
  pos_top numeric not null,   -- % ของภาพ (0-100)
  pos_left numeric not null,
  created_at timestamptz default now(),
  unique(area_id, line_name)
);
alter table public.pm_org_nodes enable row level security;
drop policy if exists pm_org_nodes_all on public.pm_org_nodes;
create policy pm_org_nodes_all on public.pm_org_nodes for all to anon, authenticated using (true) with check (true);
