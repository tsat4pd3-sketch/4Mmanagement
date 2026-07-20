-- ============================================================================
-- Kanban calc — Type B: Production Kanban (PI Press) + capacity fields
-- ============================================================================
-- TARGET PROJECT: DR / "Product DB" (eyhclzkifitbhbljgoav).
--
-- Extends the auto-kanban calculator (20260710_kanban_auto_calc.sql) with the
-- production-kanban formula for pressed parts, plus a capacity-load summary
-- (Σ part production time vs available machine time per line).
--
--   Volume/Day   = ⌈Volume/Month / working_days⌉
--   Info LT      = lot_qty * CT      Process LT = process_count * CT
--   Safety LT    = Volume/Day * CT * safety_days
--   Kanban/Lot   = ⌈lot_qty / packaging⌉
--   Kanban(sys)  = ⌈(Info+Process+Safety) / CT / packaging⌉   → total_kanban
--   Min (K/B)    = ⌈Safety / CT / packaging⌉
--   Max (K/B)    = Min + Kanban/Lot
--   Work time/part/month (sec) = (setup_time + lot_qty*CT) * (Volume/Month / lot_qty)
--   Available/line/month (sec) = hours_per_day * 3600 * working_days
--   %load = Σ work-time / available
-- CT comes from dr_products.cycle_time_sec; packaging from parts_master.
-- ============================================================================

alter table public.kanban_calc_settings
  add column if not exists hours_per_day numeric not null default 16;

alter table public.kanban_calc_params
  add column if not exists calc_type      text not null default 'withdrawal',  -- 'withdrawal' | 'production'
  add column if not exists process_count  integer,
  add column if not exists lot_qty        numeric,     -- pcs per production lot
  add column if not exists setup_time_sec numeric;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'kanban_calc_params_type_chk') then
    alter table public.kanban_calc_params
      add constraint kanban_calc_params_type_chk check (calc_type in ('withdrawal','production'));
  end if;
end $$;
