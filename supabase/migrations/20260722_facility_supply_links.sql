-- Supply Route — facility/utility จ่ายให้ไลน์ผลิตไหนบ้าง · DR project (eyhclzkifitbhbljgoav)
-- ใช้ดูผลกระทบ: ถ้า utility (ลม/ไฟ/น้ำ/หล่อเย็น) มีปัญหา/ตัดไฟซ่อม → กระทบไลน์ไหน (คำสั่ง user)
-- key ด้วย machine_id (facility/utility ใน machines) → line_name ที่จ่าย
create table if not exists public.facility_supply_links (
  id uuid primary key default gen_random_uuid(),
  machine_id   uuid not null,           -- machines.id ของ facility/utility
  line_name    text not null,           -- ไลน์ผลิตที่ utility นี้จ่ายให้
  utility_kind text,                     -- ประเภทระบบ (ลม/ไฟ/น้ำ/หล่อเย็น ฯลฯ) — อิสระ
  note         text,
  created_at   timestamptz default now(),
  unique (machine_id, line_name)
);
alter table public.facility_supply_links enable row level security;
do $$ begin
  create policy facility_supply_links_all on public.facility_supply_links for all using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.facility_supply_links to anon, authenticated;
create index if not exists idx_facility_supply_machine on public.facility_supply_links(machine_id);
create index if not exists idx_facility_supply_line on public.facility_supply_links(line_name);
