-- Target project: DR (eyhclzkifitbhbljgoav) — NOT the main project.
--
-- REVERTED. This migration originally tightened every `public`-scoped RLS
-- policy in the DR project to `authenticated` only, on the assumption that
-- anon access there was purely a leftover security gap. That assumption was
-- wrong: `supabaseDR` (src/supabaseClient.js) is a second, independent
-- Supabase client that only ever holds the DR project's anon key — the app
-- never establishes an authenticated session against that project (only
-- against the main one, via `supabase.auth`). So every DR-backed page
-- (Product Master, Machine Database, PM Setup/Check/Schedule, Daily Report,
-- Line Stock, Management, Checkin's OT flows, etc.) actually runs as `anon`
-- against that project by design, and tightening those policies broke all
-- of them immediately (e.g. "new row violates row-level security policy
-- for table production_sessions" when opening a shift).
--
-- Reverted back to `public` for every table that was `public` before this
-- migration ran. Left untouched: the 3 `notifications` policies and the
-- `user_signatures` "read all" policy, which were already `authenticated`
-- prior to this migration (not something this migration touched).
--
-- Properly closing this gap would require the DR project to actually
-- authenticate its own requests (e.g. sharing/forwarding the main
-- project's JWT, or switching DR reads/writes to go through an Edge
-- Function that validates the caller server-side) — a real architecture
-- change, out of scope for this pass. Left as a known, documented gap.

do $$
declare
  pol record;
  targets text[] := array[
    'bom_items','break_policies','checklists','child_demand_accumulator','child_lot_requests',
    'container_types','defect_logs','downtime_logs','dr_defect_types','dr_downtime_types','dr_products',
    'guests','inspection_results','inspections','jig_checkpoints','jigs','kanban_deliveries',
    'kanban_delivery_rounds','kanban_scans','kanban_standards','kanban_targets','line_stock_transactions',
    'lot_post_accumulations','lot_post_configs','lot_post_events','machine_types','machines',
    'packaging_withdrawal_requests','parts_master','pm_checking_methods','pm_checkpoint_categories',
    'prod_orders','product_packaging','production_sessions','production_shots','profiles',
    'rack_requests','raw_withdrawal_requests','tasks'
  ];
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and roles = '{authenticated}' and tablename = any(targets)
  loop
    execute format('alter policy %I on %I.%I to public', pol.policyname, pol.schemaname, pol.tablename);
  end loop;

  execute 'alter policy "Users can upsert own signature" on public.user_signatures to public';
end $$;
