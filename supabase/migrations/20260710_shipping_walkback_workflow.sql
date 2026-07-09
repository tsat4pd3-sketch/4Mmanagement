-- ── Standard Workflow การส่งงาน (backward scheduling / walkback) ──
-- Project: Product DB (eyhclzkifitbhbljgoav) — applied ผ่าน MCP แล้ว
-- (migrations: shipping_workflow_walkback, shipping_four_activities, shipping_overdue_notified)
-- 4 activity ต่อรอบส่ง: ยืนยันออเดอร์ → จัดเตรียมงาน → โหลดขึ้นรถ → ถึงลูกค้า

create table if not exists shipping_workflow_steps (
  id              uuid primary key default gen_random_uuid(),
  customer        text,                          -- null = ค่ามาตรฐานทุกลูกค้า · ระบุ code = ชุดเฉพาะลูกค้า
  step_no         integer not null default 1,
  name            text not null,
  offset_min      integer not null default 0,    -- ต้องเสร็จก่อนเวลาส่งถึงลูกค้ากี่นาที
  requires_status text not null default 'prepared'
                  check (requires_status in ('confirmed','prepared','loaded','shipped')),
  is_active       boolean default true,
  created_at      timestamptz default now()
);
create table if not exists shipping_phase_alerts (
  order_id    uuid not null references customer_shipping_orders(id) on delete cascade,
  step_id     uuid not null references shipping_workflow_steps(id) on delete cascade,
  notified_at timestamptz default now(),
  primary key (order_id, step_id)
);
-- RLS: policy for all to public (pattern เดิมของโปรเจค DR)
-- customer_shipping_orders.status: pending → confirmed → prepared → loaded → shipped
-- + คอลัมน์ overdue_notified_at timestamptz
-- default steps: ยืนยันออเดอร์ในระบบ(240,confirmed) จัดเตรียมงานเสร็จ(120,prepared)
--                โหลดสินค้าขึ้นรถ(60,loaded) สินค้าถึงลูกค้า(0,shipped)
