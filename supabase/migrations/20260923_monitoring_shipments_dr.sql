-- ═══════════════════════════════════════════════════════════════════════════════
-- 📗 รับข้อมูลจากไฟล์ Monitoring ของแพลนนิ่ง — ตารางเก็บ "ประวัติการส่ง" (DR project)
--    Supabase: "Product DB" · eyhclzkifitbhbljgoav
--    2026-09-23 · user ส่งไฟล์ 1.Monitoring-Sep.xlsx (ลูกค้าที่ไม่ส่ง EDI)
--
-- ทำไมต้องมีตารางใหม่ ไม่ยัดเข้า customer_shipping_orders:
--   ไฟล์นี้มียอด "ส่งไปแล้ว" ย้อนหลัง 1,492 แถว · ถ้าลงเป็นใบส่งของ status='shipped'
--   จะไปโผล่ในจอที่กรองด้วยวันที่ปัจจุบัน (เช่น /dept-dashboard ใช้ due_date IN (วันนี้, พรุ่งนี้)
--   แล้วนับ "ส่งแล้วกี่ใบ") ⇒ ตัวเลขส่งมอบเฟ้อขึ้นทันทีโดยไม่มีใครรู้ที่มา
--   ตารางแยก = blast radius = 0 · ย้อนกลับได้ด้วย drop table · เอาไปวิเคราะห์อัตราดึงจริงทีหลังได้
--
-- ⚠️ RLS: DR project ใช้ client `supabaseDR` ซึ่ง **วิ่งด้วย role anon เสมอ** (ไม่เคย authenticate)
--    ⇒ policy ต้องเปิดให้ public เหมือนตารางอื่นในโปรเจคนี้ ห้ามใช้ TO authenticated (เคยทำพังทั้งระบบ)
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.monitoring_shipments (
  id          uuid primary key default gen_random_uuid(),
  mat_no      text not null,
  ship_date   date not null,
  qty         numeric not null,
  kind        text not null default 'out',     -- out = ยอดส่งจริง · requirement = ORDER REQUIREMENT ที่ผ่านไปแล้ว
  sheet       text,                            -- ชีทต้นทางในไฟล์ (110T / Argen / TSPK …)
  source      text not null default 'monitoring',
  batch_id    uuid,                            -- รอบอัปโหลด (ลบทั้งรอบได้)
  note        text,
  created_at  timestamptz default now(),
  created_by_name text,
  constraint monitoring_shipments_kind_chk check (kind in ('out', 'requirement')),
  constraint monitoring_shipments_qty_chk  check (qty >= 0)
);

-- อัปโหลดไฟล์เดือนเดิมซ้ำต้องไม่เกิดแถวซ้ำ ⇒ คีย์ธรรมชาติ = พาร์ท+วัน+ชนิด+ชีท
create unique index if not exists monitoring_shipments_uniq
  on public.monitoring_shipments (mat_no, ship_date, kind, coalesce(sheet, ''));

create index if not exists monitoring_shipments_date_idx
  on public.monitoring_shipments (ship_date);

alter table public.monitoring_shipments enable row level security;

drop policy if exists monitoring_shipments_all on public.monitoring_shipments;
create policy monitoring_shipments_all on public.monitoring_shipments
  for all using (true) with check (true);

comment on table public.monitoring_shipments is
  'ประวัติการส่ง/ความต้องการที่ผ่านไปแล้ว จากไฟล์ Monitoring ของแพลนนิ่ง — ไม่ใช่ใบส่งของ ห้ามเอาไปนับเป็น KPI ส่งมอบ';
