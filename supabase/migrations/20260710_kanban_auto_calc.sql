-- ============================================================================
-- Auto-Kanban calculation from customer forecast (Type A — Withdrawal / FG store)
-- ============================================================================
-- TARGET PROJECT: DR / "Product DB" (eyhclzkifitbhbljgoav) — supabaseDR client.
--
-- Planner/Sale uploads a customer forecast (customer_forecasts, weekly buckets)
-- and the system computes the withdrawal-kanban quantities per part using the
-- PW-PC Store Calculation formula, previews them, and (on Apply) writes the
-- result into kanban_standards which the pull system already consumes.
--
--   Order/Month  = SUM(forecast qty over the target calendar month)
--   Order/Day    = Order/Month / working_days
--   CT (sec)     = 3600 / capacity_pc_hr
--   Order/Round  = CEIL(Order/Day / delivery_cycle)
--   Prep         = CEIL(prep_time_min*60 / CT)
--   Fluctuation  = CEIL((Order/Round + Prep) * fluctuation_pct/100)
--   Safety-time  = CEIL(Order/Round * (100 - efficiency_pct)/100)
--   Min stock    = CEIL(Order/Day * safety_days / packaging)      (kanban)
--   Max stock    = CEIL((Round+Prep+Fluct+Safety)/packaging) + Min (kanban)
--   Total kanban = Max stock + lot_size                           (kanban)
-- Pieces = kanban * packaging.
--
-- RLS mirrors the other DR tables (allow_all, role public) — supabaseDR is anon.
-- ============================================================================

-- global calc settings (single row)
create table if not exists public.kanban_calc_settings (
  id             text primary key default 'default',
  working_days   integer not null default 20,
  efficiency_pct numeric not null default 80,
  updated_by     text,
  updated_at     timestamptz not null default now()
);
insert into public.kanban_calc_settings (id) values ('default') on conflict (id) do nothing;

-- per-part calc parameters (Type A withdrawal). Packaging / capacity default from
-- parts_master / dr_products but are overridable here by the planner.
create table if not exists public.kanban_calc_params (
  mat_no          text primary key,
  part_name       text,
  customer        text,
  line_name       text,
  prep_time_min   numeric not null default 30,
  fluctuation_pct numeric not null default 7,
  packaging       numeric,               -- pcs per kanban
  delivery_cycle  integer not null default 1,
  capacity_pc_hr  numeric,               -- CT = 3600 / capacity
  lot_size        integer not null default 1,
  safety_days     numeric not null default 1,
  updated_by      text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- output: total kanban count (min/max already exist as min_qty/max_qty in pcs)
alter table public.kanban_standards
  add column if not exists total_kanban numeric;

do $$
declare t text;
begin
  foreach t in array array['kanban_calc_settings','kanban_calc_params'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='allow_all_'||t) then
      execute format('create policy %I on public.%I for all to public using (true) with check (true)', 'allow_all_'||t, t);
    end if;
  end loop;
end $$;
