-- ── Customer Demand: Forecast + Shipping Orders (โปรเจค DR: eyhclzkifitbhbljgoav) ──
-- applied 2026-07-08 via Supabase MCP (migration: customer_demand_tables)

create table if not exists demand_upload_batches (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('forecast','orders')),
  file_name   text,
  row_count   integer default 0,
  uploaded_by text,
  uploaded_at timestamptz default now()
);

create table if not exists customer_forecasts (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid references demand_upload_batches(id) on delete cascade,
  customer     text,
  mat_no       text not null,
  part_name    text,
  period_month date not null,
  qty          numeric not null default 0,
  note         text,
  created_at   timestamptz default now()
);
create index if not exists idx_customer_forecasts_mat_period on customer_forecasts (mat_no, period_month);
create index if not exists idx_customer_forecasts_period on customer_forecasts (period_month);

create table if not exists customer_shipping_orders (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid references demand_upload_batches(id) on delete cascade,
  order_no   text,
  customer   text,
  mat_no     text not null,
  part_name  text,
  qty        numeric not null default 0,
  due_date   date not null,
  ship_time  text,
  status     text not null default 'pending' check (status in ('pending','prepared','shipped')),
  shipped_at timestamptz,
  shipped_by text,
  note       text,
  created_at timestamptz default now()
);
create index if not exists idx_customer_shipping_orders_due on customer_shipping_orders (due_date);
create index if not exists idx_customer_shipping_orders_mat on customer_shipping_orders (mat_no);

alter table demand_upload_batches enable row level security;
alter table customer_forecasts enable row level security;
alter table customer_shipping_orders enable row level security;
create policy "demand_batches_all" on demand_upload_batches for all to public using (true) with check (true);
create policy "customer_forecasts_all" on customer_forecasts for all to public using (true) with check (true);
create policy "customer_shipping_orders_all" on customer_shipping_orders for all to public using (true) with check (true);

-- ── โปรเจคหลัก (ewhdfqwfwofivojtsizn) — applied แล้วเช่นกัน ──
-- alter type user_role add value if not exists 'sale';
-- insert into role_permissions (role, permission_key, allowed) values
--   ('manager','page:/customer-demand',true), ('supervisor','page:/customer-demand',true),
--   ('leader','page:/customer-demand',true), ('qa','page:/customer-demand',true),
--   ('sale','page:/customer-demand',true), ('sale','page:/',true),
--   ('sale','page:/dashboard',true), ('sale','page:/heijunka',true)
-- on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── เพิ่มเติม (migration: customer_demand_edi_columns) — รองรับไฟล์ EDI Ford 830/862 ──
-- alter table customer_forecasts add column customer_part_no text;
-- alter table customer_forecasts add column source text not null default 'manual';
-- alter table customer_shipping_orders add column customer_part_no text;
-- alter table customer_shipping_orders add column source text not null default 'manual';
-- alter table customer_shipping_orders add column dock_code text;

-- ── เพิ่มเติม (migration: ship_to_plants_config) — config code ปลายทาง → ลูกค้า ──
-- create table ship_to_plants (code text primary key, customer_name text not null,
--   plant_name text, note text, is_active boolean default true, updated_at timestamptz default now());
-- + RLS policy to public + seed: GRBNA GBL9A GBJWA GBJWC GBJWE HPUDA 1155B

-- ── เพิ่มเติม (2026-07-09) — แยกหน้า Planner & Sales ออกจาก Delivery ──
-- โปรเจคหลัก: seed สิทธิ์หน้าใหม่ /planner-sales โดย copy จากสิทธิ์ /customer-demand เดิม
-- (applied ผ่าน MCP แล้ว)
-- insert into role_permissions (role, permission_key, allowed)
-- select role, 'page:/planner-sales', allowed from role_permissions
-- where permission_key = 'page:/customer-demand'
-- on conflict (role, permission_key) do nothing;
