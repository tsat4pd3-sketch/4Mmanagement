-- PM Plan evolution — Phase 2 (usage-based predictive).
-- Project: Product DB (eyhclzkifitbhbljgoav), anon-open RLS (do NOT use authenticated).
--
-- Extends pm_refresh_plan to compute next_due from PRODUCTION VOLUME:
--   produced_since_PM = Σ prod_orders.qty on usage_source_line since last PM
--   ratio = produced / usage_threshold ; health_score = 100·(1-ratio) clamped
--   next_due ≈ last_PM + ceil(threshold / avg_daily_rate)
-- plan_type: 'time' (as before) | 'usage' (volume only) | 'hybrid' (min of both) .
-- A daily pg_cron refresh keeps usage/health current even without new inspections.

create or replace function public.pm_refresh_plan(p_checklist_id uuid)
returns void language plpgsql security definer as $$
declare
  v_type       text;
  v_interval   int;
  v_threshold  numeric;
  v_line       text;
  v_last       timestamptz;
  v_last_id    uuid;
  v_last_date  date;
  v_time_due   date;
  v_usage_due  date;
  v_produced   numeric;
  v_days_since numeric;
  v_rate       numeric;
  v_health     numeric;
  v_next       date;
  v_reason     text;
begin
  select plan_type, interval_days, usage_threshold, usage_source_line
    into v_type, v_interval, v_threshold, v_line
    from public.pm_plans where checklist_id = p_checklist_id;
  if not found then return; end if;

  select inspected_at, id into v_last, v_last_id
    from public.inspections
    where checklist_id = p_checklist_id
      and approval_status is distinct from 'rejected'
    order by inspected_at desc
    limit 1;
  v_last_date := case when v_last is not null then (v_last at time zone 'Asia/Bangkok')::date end;

  -- Time component (Preventive)
  if v_interval is not null and v_last_date is not null then
    v_time_due := v_last_date + v_interval;
  end if;

  -- Usage component (Predictive) — only for usage/hybrid plans with a threshold + line
  if v_type in ('usage','hybrid') and v_threshold is not null and v_threshold > 0 and v_line is not null then
    select coalesce(sum(po.qty), 0) into v_produced
      from public.prod_orders po
      join public.production_sessions ps on ps.id = po.session_id
      where ps.line_name = v_line
        and po.confirmed_at is not null
        and (v_last is null or po.confirmed_at > v_last);

    v_health := greatest(0, least(100, round(100 * (1 - v_produced / v_threshold))));

    if v_last_date is not null and v_produced > 0 then
      v_days_since := greatest(1, ((now() at time zone 'Asia/Bangkok')::date - v_last_date));
      v_rate := v_produced / v_days_since;                       -- pieces/day since last PM
      v_usage_due := v_last_date + ceil(v_threshold / v_rate)::int;
    end if;
  end if;

  -- Pick next_due by plan type
  if v_type = 'usage' then
    v_next := v_usage_due; v_reason := 'usage';
  elsif v_type = 'hybrid' then
    if v_time_due is not null and v_usage_due is not null then
      if v_usage_due <= v_time_due then v_next := v_usage_due; v_reason := 'usage';
      else v_next := v_time_due; v_reason := 'time'; end if;
    else
      v_next   := coalesce(v_usage_due, v_time_due);
      v_reason := case when v_usage_due is not null then 'usage' else 'time' end;
    end if;
  else  -- 'time' (default)
    v_next := v_time_due; v_reason := 'time';
  end if;

  update public.pm_plans set
    last_done_at       = v_last,
    last_inspection_id = v_last_id,
    next_due_date      = coalesce(v_next, next_due_date),
    next_due_reason    = coalesce(v_reason, next_due_reason),
    health_score       = v_health
  where checklist_id = p_checklist_id;
end;
$$;

-- Refresh every plan (usage accrues from production, not inspections, so a daily
-- sweep keeps next_due/health current). Safe to run any time.
create or replace function public.pm_refresh_all_plans()
returns void language plpgsql security definer as $$
declare r record;
begin
  for r in select checklist_id from public.pm_plans where is_active loop
    begin perform public.pm_refresh_plan(r.checklist_id); exception when others then null; end;
  end loop;
end;
$$;

-- Daily sweep at 01:05 UTC (08:05 Asia/Bangkok), just after the reminder scan.
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('pm-refresh-plans'); exception when others then null; end $$;
select cron.schedule('pm-refresh-plans', '5 1 * * *', $cron$ select public.pm_refresh_all_plans(); $cron$);

-- Recompute now so existing usage/hybrid plans get materialized immediately.
select public.pm_refresh_all_plans();
