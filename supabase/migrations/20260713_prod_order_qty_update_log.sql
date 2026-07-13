-- ═══════════════════════════════════════════════════════════════════
-- ประวัติการอัพเดทยอดสะสมของออเดอร์ manual — DR project (eyhclzkifitbhbljgoav)
-- พนักงานกรอกยอดจากหน้าจอเครื่องทุกช่วงเบรค → เก็บ timestamp + ยอดสะสม + ส่วนต่างจากครั้งก่อน
-- เพื่อโชว์ "ช่วงแรก 200 · ช่วงสอง +280" บนการ์ดใบ (คำขอ user 2026-07-13)
-- RLS: anon-open ตาม convention ฝั่ง DR — do NOT switch to TO authenticated
-- ═══════════════════════════════════════════════════════════════════

create table if not exists prod_order_qty_updates (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references prod_orders(id) on delete cascade,
  qty_accum integer not null,          -- ยอดสะสม ณ ตอนกรอก
  qty_delta integer not null,          -- ส่วนต่างจากการกรอกครั้งก่อน (ครั้งแรก = ยอดสะสมทั้งก้อน)
  is_final boolean not null default false, -- true = แถวตอนปิดใบ (ยอดจริงสุดท้าย)
  logged_at timestamptz not null default now(),
  logged_by text
);

create index if not exists idx_po_qty_updates_order on prod_order_qty_updates(order_id, logged_at);

alter table prod_order_qty_updates enable row level security;
drop policy if exists po_qty_updates_all on prod_order_qty_updates;
create policy po_qty_updates_all on prod_order_qty_updates
  for all to public using (true) with check (true);
