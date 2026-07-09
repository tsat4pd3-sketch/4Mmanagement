-- PM Plan evolution — Phase 1 (foundation)
-- Project: Product DB (eyhclzkifitbhbljgoav), accessed by the app via the `anon`
-- supabaseDR client. RLS therefore stays anon-open (same as every other PM table);
-- do NOT switch these to `TO authenticated` — the client carries no JWT.
--
-- Adds one persisted plan per checklist and materializes `next_due_date`
-- server-side (timezone-correct, Asia/Bangkok) so PMSchedule reads instead of
-- recomputing, and so usage/condition trigger types can slot in later (Phase 2/3).
--
-- Design note: the maintenance triggers on `checklists`/`inspections` wrap the
-- plan refresh in an exception handler, so a plan-side error can NEVER block the
-- app's core inserts/updates on those tables.

-- ─── pm_plans ─────────────────────────────────────────────────────────────────
create table if not exists public.pm_plans (
  id                 uuid primary key default gen_random_uuid(),
  checklist_id       uuid not null references public.checklists(id) on delete cascade,
  plan_type          text not null default 'time',   -- 'time' | 'usage' | 'condition' | 'hybrid'

  -- Preventive (time)
  interval_days      int,

  -- Predictive (usage) — reserved for Phase 2
  usage_metric       text,                            -- 'produced_qty' | 'shot_count'
  usage_threshold    numeric,
  usage_source_line  text,

  -- Predictive (condition) — reserved for Phase 3
  condition_rules    jsonb,

  -- Materialized read model
  next_due_date      date,
  next_due_reason    text,                            -- 'time' | 'usage' | 'condition'
  health_score       numeric,
  last_done_at       timestamptz,
  last_inspection_id uuid references public.inspections(id) on delete set null,

  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  constraint pm_plans_type_check check (plan_type in ('time','usage','condition','hybrid')),
  unique (checklist_id)
);

alter table public.pm_plans enable row level security;
drop policy if exists pm_plans_all on public.pm_plans;
create policy pm_plans_all on public.pm_plans
  for all to anon, authenticated using (true) with check (true);

-- ─── helpers ──────────────────────────────────────────────────────────────────
-- frequency label → interval days (periodic / unknown → NULL = no fixed cycle)
create or replace function public.pm_freq_to_days(freq text)
returns int language sql immutable as $$
  select case freq
    when 'daily'     then 1
    when 'weekly'    then 7
    when 'monthly'   then 30
    when 'quarterly' then 90
    else null
  end;
$$;

-- Recompute the materialized fields for one checklist's plan from its most recent
-- non-rejected inspection. Time-based only for now; usage/condition come later.
create or replace function public.pm_refresh_plan(p_checklist_id uuid)
returns void language plpgsql security definer as $$
declare
  v_type     text;
  v_interval int;
  v_last     timestamptz;
  v_last_id  uuid;
begin
  select plan_type, interval_days into v_type, v_interval
    from public.pm_plans where checklist_id = p_checklist_id;
  if not found then return; end if;

  select inspected_at, id into v_last, v_last_id
    from public.inspections
    where checklist_id = p_checklist_id
      and approval_status is distinct from 'rejected'
    order by inspected_at desc
    limit 1;

  update public.pm_plans set
    last_done_at       = v_last,
    last_inspection_id = v_last_id,
    next_due_date      = case
                           when v_type = 'time' and v_last is not null and v_interval is not null
                           then ((v_last at time zone 'Asia/Bangkok')::date + v_interval)
                           else next_due_date
                         end,
    next_due_reason    = case when v_type = 'time' then 'time' else next_due_reason end
  where checklist_id = p_checklist_id;
end;
$$;

-- ─── triggers: keep plans in sync, but never block the core write ─────────────
create or replace function public.pm_checklist_sync()
returns trigger language plpgsql security definer as $$
begin
  begin
    if (tg_op = 'INSERT') then
      insert into public.pm_plans (checklist_id, plan_type, interval_days, next_due_reason)
        values (NEW.id, 'time', public.pm_freq_to_days(NEW.frequency), 'time')
        on conflict (checklist_id) do nothing;
      perform public.pm_refresh_plan(NEW.id);
    elsif (tg_op = 'UPDATE' and NEW.frequency is distinct from OLD.frequency) then
      update public.pm_plans
        set interval_days = public.pm_freq_to_days(NEW.frequency)
        where checklist_id = NEW.id and plan_type = 'time';
      perform public.pm_refresh_plan(NEW.id);
    end if;
  exception when others then null;  -- plan upkeep must never break a checklist write
  end;
  return null;
end;
$$;
drop trigger if exists trg_pm_checklist_sync on public.checklists;
create trigger trg_pm_checklist_sync
  after insert or update on public.checklists
  for each row execute function public.pm_checklist_sync();

create or replace function public.pm_inspection_sync()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform public.pm_refresh_plan(coalesce(NEW.checklist_id, OLD.checklist_id));
  exception when others then null;  -- plan upkeep must never break an inspection write
  end;
  return null;
end;
$$;
drop trigger if exists trg_pm_inspection_sync on public.inspections;
create trigger trg_pm_inspection_sync
  after insert or update or delete on public.inspections
  for each row execute function public.pm_inspection_sync();

-- ─── backfill existing checklists ─────────────────────────────────────────────
insert into public.pm_plans (checklist_id, plan_type, interval_days, next_due_reason)
  select id, 'time', public.pm_freq_to_days(frequency), 'time'
  from public.checklists
  on conflict (checklist_id) do nothing;

do $$
declare r record;
begin
  for r in select checklist_id from public.pm_plans loop
    perform public.pm_refresh_plan(r.checklist_id);
  end loop;
end $$;
