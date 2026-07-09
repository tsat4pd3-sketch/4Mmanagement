-- System 3 — Maintenance Planned PM staged reminders (30 / 14 / 3 วัน + เกินกำหนด).
-- Project: Product DB (eyhclzkifitbhbljgoav), read by the app via the anon
-- supabaseDR client. anon-open RLS like every PM table — do NOT use TO authenticated.
--
-- Dedup log: one reminder per (plan, due-cycle, stage) so the daily scan fires
-- each stage exactly once. When a plan's next_due_date rolls to a new cycle
-- (after the PM is done), the (plan, new due_date, stage) key is fresh again.

create table if not exists public.pm_plan_reminders (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.pm_plans(id) on delete cascade,
  due_date   date not null,
  stage      text not null,        -- 'd30' | 'd14' | 'd3' | 'overdue'
  sent_at    timestamptz not null default now(),
  unique (plan_id, due_date, stage)
);

alter table public.pm_plan_reminders enable row level security;
drop policy if exists pm_plan_reminders_all on public.pm_plan_reminders;
create policy pm_plan_reminders_all on public.pm_plan_reminders
  for all to anon, authenticated using (true) with check (true);
