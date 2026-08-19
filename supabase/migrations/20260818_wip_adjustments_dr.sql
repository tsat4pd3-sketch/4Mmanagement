-- ═══ WIP ระหว่างขั้น — ตารางยอดนับจริง (baseline) · เฟส 1 ของแผง 📦 WIP (2026-08-18) ═══
-- โปรเจค: DR (eyhclzkifitbhbljgoav)
--
-- แผง WIP คำนวณยอดค้างระหว่างขั้นจากใบผลิต (Σขั้น − Σปลายทาง) โดยไม่ต้องคีย์รับ-จ่าย
-- แต่ของเสียระหว่างทาง/ยอดก่อนเริ่มระบบ ทำตัวเลข drift → หัวหน้ากด "นับจริง" เก็บ baseline
-- แล้วระบบนับต่อจากจุดนั้น (WIP = ยอดนับจริง + Σขั้นหลังเวลานับ − Σปลายทางหลังเวลานับ)
--
-- เก็บเป็นประวัติ (insert ใหม่ทุกครั้ง ไม่ update ทับ) — ใช้แถวล่าสุดต่อ buffer_key เป็น baseline
-- บัญชีภายในแผนกล้วน ไม่เกี่ยว SAP/สต็อกทางการ (line_stock_transactions ไม่ถูกแตะ)
--
-- Rollback: drop table wip_adjustments;  (โค้ดอ่านแบบ best-effort — ตารางไม่มี = baseline ว่าง
--   แผงยังคำนวณจากใบผลิตทั้งหมดได้ แค่ปุ่มนับจริงบันทึกไม่ได้ + แจ้งบนจอ)

create table if not exists wip_adjustments (
  id uuid primary key default gen_random_uuid(),
  buffer_key text not null,          -- mat ของขั้นที่นับ (buffer หลังขั้นนั้น)
  counted_qty numeric not null check (counted_qty >= 0),
  counted_at timestamptz not null default now(),
  note text,
  updated_by_name text,              -- ผู้นับ (DR เป็น anon — stamp จาก client ตาม convention)
  created_at timestamptz not null default now()
);

create index if not exists wip_adjustments_key_idx on wip_adjustments (buffer_key, counted_at desc);

alter table wip_adjustments enable row level security;
do $$ begin
  create policy wip_adjustments_all on wip_adjustments for all using (true) with check (true);
exception when duplicate_object then null; end $$;
