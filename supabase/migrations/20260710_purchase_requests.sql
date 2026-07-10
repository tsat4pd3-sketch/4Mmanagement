-- ============================================================================
-- Purchase requests — replenishment path for BOUGHT parts (3xx child, 5xx raw)
-- ============================================================================
-- TARGET PROJECT: DR / "Product DB" (eyhclzkifitbhbljgoav) — supabaseDR client.
--
-- The pull system previously forced EVERY short BOM part through the
-- "produce in-house" flow (child_lot_requests -> เริ่มผลิต). But parts whose
-- mat_no starts with 3 (child bought) or 5 (raw material) are PURCHASED from a
-- supplier, not produced. This table is their queue: a 2-step flow
--   pending  -> (store places PO)      ordered
--   ordered  -> (goods arrive, รับเข้า) received  => stock += qty at dest_line
-- No approval step — receiving confirms straight into stock.
--
-- RLS mirrors the other DR pull tables (allow_all, role public) because the
-- supabaseDR client is always anon (see CLAUDE.md > Supabase Projects).
-- ============================================================================

create table if not exists public.purchase_requests (
  id             uuid primary key default gen_random_uuid(),
  work_date      date not null default current_date,
  mat_no         text not null,
  part_name      text,
  qty            numeric not null,
  dest_line      text,            -- line whose store stock this replenishes
  supplier       text,            -- from parts_master.supplier (informational)
  source_prod_no text,            -- FG prod_no that triggered the demand
  status         text not null default 'pending',
  ordered_by     text,
  ordered_at     timestamptz,
  received_by    text,
  received_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint purchase_requests_status_chk
    check (status in ('pending','ordered','received','cancelled'))
);

create index if not exists idx_purchase_requests_status on public.purchase_requests(status);

alter table public.purchase_requests enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='purchase_requests' and policyname='allow_all_purchase_requests') then
    create policy allow_all_purchase_requests on public.purchase_requests
      for all to public using (true) with check (true);
  end if;
end $$;
