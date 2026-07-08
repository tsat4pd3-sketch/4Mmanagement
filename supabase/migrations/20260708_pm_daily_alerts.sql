-- System 1 — dedupe log for the Daily PM orange (missed-in-time) alarm.
-- Project: Product DB (eyhclzkifitbhbljgoav). One orange per line/shift/day.
create table if not exists public.pm_daily_alerts (
  id          uuid primary key default gen_random_uuid(),
  line_name   text not null,
  work_date   date not null,
  shift       text not null,
  color       text not null,       -- 'orange' (reserved for future colors)
  sent_at     timestamptz not null default now(),
  unique (line_name, work_date, shift, color)
);
alter table public.pm_daily_alerts enable row level security;
drop policy if exists pm_daily_alerts_all on public.pm_daily_alerts;
create policy pm_daily_alerts_all on public.pm_daily_alerts
  for all to anon, authenticated using (true) with check (true);
