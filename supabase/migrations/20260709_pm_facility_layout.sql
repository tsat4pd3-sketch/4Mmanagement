-- MTN-owned facility/utility floor layout (air compressors, water pumps, MDB…).
-- Project: Product DB (eyhclzkifitbhbljgoav), read/written by the app via the
-- anon supabaseDR client. anon-open RLS like every PM table — NOT TO authenticated.
--
-- Production owns machine_points (on production lines, MAIN project). Facility
-- equipment lives off the lines, so Maintenance places it on its own zones here.
-- Positions are % strings of the zone image (same convention as machine_points).

create table if not exists public.pm_facility_areas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image_path  text,            -- bucket 'jig-images', path facility/{id}.{ext}
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.pm_facility_areas enable row level security;
drop policy if exists pm_facility_areas_all on public.pm_facility_areas;
create policy pm_facility_areas_all on public.pm_facility_areas
  for all to anon, authenticated using (true) with check (true);

create table if not exists public.pm_facility_points (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.pm_facility_areas(id) on delete cascade,
  jig_id      uuid not null references public.jigs(id) on delete cascade,
  pos_top     text,            -- e.g. '42.10%'
  pos_left    text,
  created_at  timestamptz not null default now(),
  unique (area_id, jig_id)
);
alter table public.pm_facility_points enable row level security;
drop policy if exists pm_facility_points_all on public.pm_facility_points;
create policy pm_facility_points_all on public.pm_facility_points
  for all to anon, authenticated using (true) with check (true);
