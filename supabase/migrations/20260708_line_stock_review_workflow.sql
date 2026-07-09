-- ============================================================================
-- Line Stock — Store Review Workflow
-- ============================================================================
-- TARGET PROJECT: DR / "Product DB" (eyhclzkifitbhbljgoav) — supabaseDR client.
--   (line_stock_transactions / line_stock_summary live in the DR project, NOT
--    the main SHOP FLOOR project. See CLAUDE.md > Supabase Projects.)
--
-- Adds an approval gate to MANUAL stock movements entered from the Line Stock
-- page. Movements the app marks 'pending' do not affect on-hand until an
-- authorised user approves them.
--
-- SAFETY — why this does not disturb existing behaviour:
--   * status DEFAULTS to 'approved', so every existing row and every
--     auto-writer that omits the column keeps affecting on-hand exactly as
--     before. Auto-writers that rely on the default:
--       - trigger trg_explode_child_demand on prod_orders (inserts 'consume')
--       - DailyReport close/approve auto-consume
--       - Heijunka confirmRound 'issue' + advanceLot 'issue'/'consume'
--         + submitReceive 'consume'
--   * The view keeps the same columns (line_name, mat_no, part_name,
--     qty_on_hand); only a `where status = 'approved'` filter is added.
--   * Verified empirically: line_stock_summary md5 hash + row count were
--     identical before and after this migration (all 24 existing rows became
--     'approved').
--
-- The app currently marks only manual `adjust` (stocktake correction) as
-- 'pending'; manual issue/return stay immediate. The reviewed set is a single
-- config array (REVIEW_TYPES) in src/pages/LineStock.jsx.
-- ============================================================================

alter table public.line_stock_transactions
  add column if not exists status        text not null default 'approved',
  add column if not exists reviewed_by   text,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists reject_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'line_stock_transactions_status_chk') then
    alter table public.line_stock_transactions
      add constraint line_stock_transactions_status_chk
      check (status in ('pending','approved','rejected'));
  end if;
end $$;

-- On-hand counts approved rows only (pending/rejected are excluded until
-- reviewed). Column list is unchanged from the previous definition.
create or replace view public.line_stock_summary as
  select line_name,
         mat_no,
         max(part_name) as part_name,
         sum(case when type = any (array['issue'::text, 'adjust'::text])   then qty
                  when type = any (array['consume'::text, 'return'::text]) then -qty
                  else 0::numeric end) as qty_on_hand
  from line_stock_transactions
  where status = 'approved'
  group by line_name, mat_no;
