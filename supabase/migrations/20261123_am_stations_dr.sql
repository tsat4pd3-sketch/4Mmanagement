-- DR (eyhclzkifitbhbljgoav · ชื่อในจอ Supabase "Product DB") · 2026-11-23 · คำสั่ง user
-- "ใบ AM ของเครื่องที่ติดตั้งคู่กัน (robot + gripper + stationary + nut feeder) ไม่ต้องเปิดทีละใบ"
-- user เลือก 23/11: จับกลุ่มเป็น "สถานี" · จุดตรวจ AM ยังตั้งรายอุปกรณ์เหมือนเดิม · บอร์ด AM นับเป็นสถานี
-- 📄 docs/modules/pm-hub-check-setup.md §🧩 สถานี AM
--
-- am_stations         1 แถว = 1 สถานี (ชุดอุปกรณ์ที่พนักงานตรวจ AM ในใบเดียว)
-- am_station_members  อุปกรณ์ (jigs) ในสถานี · 1 อุปกรณ์อยู่ได้ 1 สถานี (unique jig_id)
-- ผลตรวจยังเก็บ "รายอุปกรณ์" ใน inspections เหมือนเดิม — ตารางนี้แค่บอกว่าอะไรตรวจพร้อมกัน
-- PM ของช่างไม่แตะเลย (แต่ละทีมยัง PM ตัวของตัวเอง)
--
-- RLS: anon-open แบบตาราง PM ทุกตัวฝั่ง DR (supabaseDR ไม่เคย authenticate — ห้ามเปลี่ยนเป็น TO authenticated)
--      ด่านสิทธิ์ (pm:setup) + ขอบเขตไลน์อยู่ฝั่งจอ — known gap ของ DR ทั้งระบบ (permission-scope-audit.md)
-- backward-compatible: ตารางใหม่ล้วน ไม่แตะตารางเดิม
-- ↩️ rollback (ย้อนโค้ดก่อน): drop table if exists public.am_station_members; drop table if exists public.am_stations;

create table if not exists public.am_stations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  line_name       text not null,
  note            text,
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz default now(),
  updated_by_name text
);
create unique index if not exists am_stations_line_name_uniq on public.am_stations (line_name, name) where is_active;
create index if not exists am_stations_line_idx on public.am_stations (line_name) where is_active;

create table if not exists public.am_station_members (
  id              uuid primary key default gen_random_uuid(),
  station_id      uuid not null references public.am_stations(id) on delete cascade,
  jig_id          uuid not null references public.jigs(id) on delete cascade,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz default now(),
  updated_by_name text,
  constraint am_station_members_jig_uniq unique (jig_id)
);
create index if not exists am_station_members_station_idx on public.am_station_members (station_id, sort_order);

alter table public.am_stations        enable row level security;
alter table public.am_station_members enable row level security;
drop policy if exists am_stations_all on public.am_stations;
create policy am_stations_all on public.am_stations for all to anon, authenticated using (true) with check (true);
drop policy if exists am_station_members_all on public.am_station_members;
create policy am_station_members_all on public.am_station_members for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.am_stations, public.am_station_members to anon, authenticated;

-- audit + updated_at (fn_audit / fn_set_updated_at จาก 20260724_audit_log_dr.sql)
do $$
declare t text;
begin
  foreach t in array array['am_stations','am_station_members'] loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
  end loop;
end $$;

-- ตรวจผล:
-- select table_name, privilege_type from information_schema.role_table_grants
--  where table_name in ('am_stations','am_station_members') and grantee='anon' order by 1,2;
