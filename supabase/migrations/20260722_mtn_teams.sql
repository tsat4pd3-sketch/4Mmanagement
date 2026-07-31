-- ทีมช่างซ่อมบำรุง (data-driven) — เลิก hardcode ชื่อทีมในโค้ด (คำสั่ง user 2026-07-22)
-- DR project (eyhclzkifitbhbljgoav) · key ตรงกับ checklists.department (คงเดิม) เพิ่ม/แก้ทีมได้จากตารางนี้
--   label = ชื่อแสดงผล · equip_type = ประเภทอุปกรณ์ default (ใช้ตอนสร้าง checklist + fallback หน้า Check)
--   dept_name = ชื่อทีมฝั่งแจ้งซ่อม (mtn_orders.mtn_dept) เพื่อโยง 2 ฝั่งให้ตรงกัน
create table if not exists public.mtn_teams (
  id uuid primary key default gen_random_uuid(),
  key        text unique not null,     -- maintenance / jig_maintenance / die_maintenance / production
  label      text not null,            -- MTN / JIG MTN / DIE MTN / PRODUCTION
  icon       text,
  equip_type text,                      -- machine / jig / die / null(production)
  dept_name  text,                      -- โยงกับ mtn_orders.mtn_dept (MTN/JIG MTN/DIE MTN/PRODUCTION)
  color      text,
  sort_order int default 0,
  is_active  boolean default true,
  created_at timestamptz default now()
);
alter table public.mtn_teams enable row level security;
do $$ begin
  create policy mtn_teams_all on public.mtn_teams for all using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.mtn_teams to anon, authenticated;

insert into public.mtn_teams (key, label, icon, equip_type, dept_name, color, sort_order) values
  ('maintenance',     'MTN (ซ่อมบำรุง)',      '🔧', 'machine', 'MTN',      '#fb923c', 1),
  ('jig_maintenance', 'JIG MTN',              '🧩', 'jig',     'JIG MTN',  '#34d399', 2),
  ('die_maintenance', 'DIE MTN',              '🗜️', 'die',     'DIE MTN',  '#4d9fff', 3),
  ('production',      'PRODUCTION (ฝ่ายผลิต)', '🏭', null,      'PRODUCTION', '#3dd65c', 4)
on conflict (key) do nothing;
