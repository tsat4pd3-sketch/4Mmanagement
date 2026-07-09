-- System 1 (Production Daily Preventive Maintenance) — registry of equipment
-- that must be checked every shift, per line. This is the "N" in "checked X/N".
-- Project: Product DB (eyhclzkifitbhbljgoav); app client is anon → RLS anon-open
-- (same as every other PM table; do NOT switch to TO authenticated).
--
-- A jig already carries line_name, but the registry is kept line-explicit so the
-- daily-PM obligation set is deliberate (not every jig on a line needs a daily
-- check) and can differ per shift if needed. shift NULL = applies to all shifts.

create table if not exists public.pm_daily_line_targets (
  id          uuid primary key default gen_random_uuid(),
  line_name   text not null,
  jig_id      uuid not null references public.jigs(id) on delete cascade,
  shift       text,                          -- NULL = every shift | 'day' | 'night'
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint pm_daily_line_targets_shift_check check (shift is null or shift in ('day','night'))
);

-- One registration per (line, jig, shift); treat NULL shift as a distinct "all"
-- slot so (line, jig, NULL) can't be duplicated.
create unique index if not exists pm_daily_line_targets_uniq
  on public.pm_daily_line_targets (line_name, jig_id, coalesce(shift, '*'));

create index if not exists pm_daily_line_targets_line_idx
  on public.pm_daily_line_targets (line_name) where is_active;

alter table public.pm_daily_line_targets enable row level security;
drop policy if exists pm_daily_line_targets_all on public.pm_daily_line_targets;
create policy pm_daily_line_targets_all on public.pm_daily_line_targets
  for all to anon, authenticated using (true) with check (true);
