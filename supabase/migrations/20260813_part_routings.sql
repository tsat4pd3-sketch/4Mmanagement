-- ✅ apply แล้ว 2026-08-13 (DR)
-- Routing master — ลำดับกระบวนการของแต่ละพาร์ท (พาร์ท → ขั้น 1,2,3 → เครื่อง/ไลน์)
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive
--
-- ทำไมต้องมี: `bom_items` เก็บแค่ FG → ลูก 1 ชั้น ระบบจึงไม่เคยรู้ว่าพาร์ทหนึ่งผ่าน
-- กี่ขั้น เรียงยังไง (ปั๊ม 300T → Store Blank → ปั๊ม 600T → Store Semi → ประกอบ)
-- ตารางนี้คือชั้นที่ขาดไป — ใช้สร้าง VSM และต่อยอดได้อีก (capacity/ต้นทุน/แผน PM)
--
-- กติกา:
--  · ค่า null ทุกช่อง = "ให้ระบบไปหาจากข้อมูลจริง" (CT จาก dr_products · OEE/setup จากกะที่ปิดแล้ว
--    · lot จาก kanban_standards · คนจาก std manpower) — กรอกทับได้เมื่อค่าจริงไม่ตรงกับที่ต้องการ
--  · `wip_qty` เป็นตัวเลขที่ต้องกรอกเอง (ระบบไม่ได้เก็บ WIP กลางทาง — ดู VSM-DESIGN.md §2)
--  · `mat_no` ไม่ผูก FK กับ dr_products/parts_master โดยตั้งใจ (พาร์ทกลางทางบางตัวยังไม่มีเลข SAP)

create table if not exists public.part_routings (
  id            uuid primary key default gen_random_uuid(),
  mat_no        text    not null,
  seq           int     not null,
  step_name     text    not null,          -- ชื่อที่โชว์ในกล่อง VSM เช่น 'STAMPING PRESS 300 TON'
  line_name     text,                      -- ไลน์ที่ทำ (null = จ้างนอก/ยังไม่ระบุ)
  machine_no    text,
  process_type  text,                      -- อ้าง process_types.key
  ct_sec        numeric,                   -- null = ใช้ dr_products.cycle_time_sec
  setup_sec     numeric,                   -- C/O · null = ค่ากลางจาก downtime six_big_loss='setup'
  lot_size      numeric,                   -- null = kanban_standards.lot_size
  operators     numeric,                   -- null = std manpower ของไลน์
  is_outsourced boolean not null default false,
  vendor_name   text,                      -- ผู้รับจ้างช่วง (เช่น JAROONRAT พ่นสี)
  wip_label     text,                      -- ชื่อจุดพักหลังขั้นนี้ ('Store Blank')
  wip_qty       numeric,                   -- จำนวนคงคลังจุดพัก (กรอกเอง)
  note          text,
  is_active     boolean not null default true,
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 1 พาร์ท = 1 ขั้นต่อลำดับ (partial → แถวที่ปิดใช้งานเก็บเป็นประวัติได้)
create unique index if not exists part_routings_mat_seq_uniq
  on public.part_routings (mat_no, seq) where is_active;
create index if not exists part_routings_mat_idx  on public.part_routings (mat_no);
create index if not exists part_routings_line_idx on public.part_routings (line_name);

alter table public.part_routings enable row level security;
-- ฝั่ง DR client เป็น anon เสมอ (กฎเหล็ก CLAUDE.md) — ห้ามตั้ง TO authenticated
drop policy if exists part_routings_all on public.part_routings;
create policy part_routings_all on public.part_routings for all using (true) with check (true);

-- updated_at + audit (pattern เดียวกับตาราง master อื่นฝั่ง DR)
drop trigger if exists trg_set_updated_at on public.part_routings;
create trigger trg_set_updated_at before update on public.part_routings
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_audit on public.part_routings;
create trigger trg_audit after insert or update or delete on public.part_routings
  for each row execute function public.fn_audit();

-- Rollback:
--   drop table public.part_routings;
