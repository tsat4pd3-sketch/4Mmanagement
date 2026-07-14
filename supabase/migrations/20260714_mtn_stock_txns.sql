-- Stock control อะไหล่ MTN — ledger การเคลื่อนไหวสต็อก (2026-07-14) · Project: DR
create table if not exists public.mtn_stock_txns (
  id uuid primary key default gen_random_uuid(),
  part_id  uuid references public.mtn_spare_parts(id) on delete cascade,
  type     text not null,            -- in (รับเข้า) | adjust (ปรับ) | consume (เบิกใช้ในงาน)
  qty      numeric not null,         -- +รับเข้า / ±ปรับ / -เบิก
  balance  numeric,                  -- ยอดคงเหลือหลังรายการ (snapshot)
  ref_order_id uuid,                 -- ถ้า consume จากใบ MO
  note     text,
  by_name  text,
  created_at timestamptz not null default now()
);
create index if not exists idx_mtn_stock_txns_part on public.mtn_stock_txns(part_id);
alter table public.mtn_stock_txns enable row level security;
drop policy if exists mtn_stock_txns_all on public.mtn_stock_txns;
create policy mtn_stock_txns_all on public.mtn_stock_txns for all to anon, authenticated using (true) with check (true);
alter table public.mtn_spare_parts add column if not exists min_qty numeric not null default 0;  -- min stock (แจ้งใกล้หมด)
