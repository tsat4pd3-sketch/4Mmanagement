-- ══ 🚚 ตารางรอบรับของลูกค้า (pickup schedule) — data-driven ต่อ ship-to × dock × pattern ══
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ที่มา (user 2026-09-09 · ส่งตาราง "E-SMART Pattern normal / OT" ของ AAT มาให้):
--   *"อันนี้รอบของ AAT"* + *"ต้องทำเป็นระบบให้รองรับการแก้ไขได้นะ สำหรับโรงงานอื่น แต่ของเรา seed ไปเลย"*
--
-- ⚠️ ทำไมต้องมีตารางนี้ — สูตรเดิม `รอบ = ปลายช่วง + lead_min (60 นาที)` **เดาผิด**:
--   ช่วงดึง 10:00-12:00 สูตรได้ 13:00 แต่**ตารางจริงของลูกค้าคือ 14:00**
--   (ช่วงอื่นบังเอิญตรง: 06:00-08:00→09:00 · 08:00-10:00→11:00 · 12:00-14:00→15:00)
--   ⇒ รอบส่งเป็น **ตารางที่ลูกค้ากำหนด ไม่ใช่สูตรคณิตศาสตร์** — ระยะห่างไม่คงที่
--      (14:00-16:00 → รับ 22:00 = ห่าง 6 ชม. · 16:00-22:00 → รับ 23:00 = ห่าง 1 ชม.)
--   `customer_pull_formats.lead_min` ยังอยู่เป็น **fallback** เมื่อไม่มีแถวในตารางนี้ (โรงงาน/ลูกค้าที่ยังไม่ได้ตั้ง)

create table if not exists public.customer_pull_rounds (
  id            uuid primary key default gen_random_uuid(),
  ship_to       text not null,                       -- ปลายทาง เช่น GRBNA (AAT)
  dock_code     text,                                -- B1 / B5 — null = ใช้ได้ทุก dock (fallback ของ ship-to นั้น)
  supplier_code text,                                -- รหัสผู้ส่งของเราในระบบลูกค้า เช่น GUD6A (เผื่อหลายโรงงานในกลุ่ม)
  pattern       text not null default 'normal',      -- normal | ot_day | ot_night
  period_start  text not null,                       -- 'HH:MM' ต้นช่วงดึงในไฟล์ e-SMART
  period_end    text not null,                       -- 'HH:MM' ปลายช่วง (ข้ามเที่ยงคืนได้ เช่น 22:00-00:00)
  prepare_from  text,                                -- ช่วงจัดเตรียม (แสดงผล/วางแผนกำลังคน — ยังไม่ผูก logic)
  prepare_to    text,
  pickup_time   text not null,                       -- ⭐ เวลาที่รถลูกค้ามารับ = ship_time ของใบส่ง
  pickup_day_offset smallint not null default 0,     -- +วัน นับจาก "วันของ period_end" (ของ AAT = 0 ทุกแถว)
  delivery_time text,                                -- เวลาถึงลูกค้า (อ้างอิง ไม่ใช้คำนวณ)
  sort_order    int,
  is_active     boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by_name text
);

comment on table public.customer_pull_rounds is
  'ตารางรอบรับของลูกค้า (milk-run pickup schedule) — e-SMART/pull signal ใช้หา ship_time ของรอบนั้น · แก้ได้จาก /customer-demand แท็บ ⚙️ Ship-to Config · ไม่มีแถวที่ตรง = fallback ไปที่ customer_pull_formats.lead_min';
comment on column public.customer_pull_rounds.pickup_time is
  '⭐ เวลาที่รถลูกค้ามารับ = ship_time ของใบส่ง — เป็นค่าจากตารางลูกค้า ห้ามคำนวณจากปลายช่วง (ระยะห่างไม่คงที่: 1-6 ชม.)';
comment on column public.customer_pull_rounds.pickup_day_offset is
  'บวกกี่วันจากวันของ period_end — ของ AAT เป็น 0 ทุกแถว (แถวข้ามคืนก็ยังอยู่วันเดียวกับ period_end) · เผื่อลูกค้าที่รับข้ามวันจริงๆ';

create unique index if not exists customer_pull_rounds_uniq
  on public.customer_pull_rounds (ship_to, coalesce(dock_code, ''), pattern, period_start, period_end);
create index if not exists customer_pull_rounds_lookup
  on public.customer_pull_rounds (ship_to, is_active);

alter table public.customer_pull_rounds enable row level security;
-- ⚠️ ฝั่ง DR project client วิ่งด้วย role anon เสมอ (supabaseDR ไม่ authenticate) — ตาม convention ของ project นี้
-- ห้ามเปลี่ยนเป็น TO authenticated (ดูกฎเหล็กใน CLAUDE.md)
drop policy if exists customer_pull_rounds_all on public.customer_pull_rounds;
create policy customer_pull_rounds_all on public.customer_pull_rounds for all using (true) with check (true);

/* ── seed ตารางจริงของ AAT (ship-to GRBNA · supplier GUD6A) ────────────────────────
   ถอดจากใบ "E-SMART Pattern normal / Pattern OT" ที่ user ส่งมา 2026-09-09
   on conflict do nothing ⇒ รันซ้ำได้ และไม่ทับค่าที่ user แก้เองทีหลัง */
insert into public.customer_pull_rounds
  (ship_to, dock_code, supplier_code, pattern, period_start, period_end, prepare_from, prepare_to, pickup_time, delivery_time, sort_order, note)
values
  -- ── Dock B1 · normal ──────────────────────────────────────────────────────────
  ('GRBNA','B1','GUD6A','normal','06:00','10:00','10:10','11:00','13:15','14:00', 10, null),
  ('GRBNA','B1','GUD6A','normal','10:00','22:00','22:10','23:00','23:15','00:10', 20, null),
  ('GRBNA','B1','GUD6A','normal','22:00','02:00','02:10','03:00','03:15','04:00', 30, null),
  ('GRBNA','B1','GUD6A','normal','02:00','06:00','06:10','07:00','08:15','09:00', 40, null),
  -- ── Dock B5 · normal (กลางวัน) ────────────────────────────────────────────────
  ('GRBNA','B5','GUD6A','normal','08:00','10:00','10:10','11:00','11:00','12:30', 10, null),
  ('GRBNA','B5','GUD6A','normal','10:00','12:00','13:10','14:00','14:00','14:30', 20,
   'สูตร ปลายช่วง+60 เดาเป็น 13:00 — ตารางจริงคือ 14:00 (เหตุผลที่ต้องมีตารางนี้)'),
  ('GRBNA','B5','GUD6A','normal','12:00','14:00','14:10','15:00','15:00','16:00', 30, null),
  ('GRBNA','B5','GUD6A','normal','14:00','16:00','16:10','17:00','22:00','22:30', 40,
   'ห่างจากปลายช่วง 6 ชม. — ระยะห่างไม่คงที่ ห้ามคำนวณเอา'),
  ('GRBNA','B5','GUD6A','normal','16:00','22:00','22:10','23:00','23:00','00:10', 50, null),
  -- ── Dock B5 · normal (กลางคืน) ────────────────────────────────────────────────
  ('GRBNA','B5','GUD6A','normal','22:00','00:00','00:10','01:00','01:00','01:50', 60, null),
  ('GRBNA','B5','GUD6A','normal','00:00','02:00','02:10','03:00','03:00','04:00', 70, null),
  ('GRBNA','B5','GUD6A','normal','02:00','04:00','04:10','05:00','05:00','06:00', 80, null),
  ('GRBNA','B5','GUD6A','normal','04:00','06:00','06:10','07:00','07:00','08:30', 90, null),
  ('GRBNA','B5','GUD6A','normal','06:00','08:00','08:10','09:00','09:00','10:10',100, null),
  -- ── Dock B5 · OT Day ──────────────────────────────────────────────────────────
  ('GRBNA','B5','GUD6A','ot_day','08:00','10:00','10:10','11:00','11:00','12:30', 10, null),
  ('GRBNA','B5','GUD6A','ot_day','10:00','12:00','13:10','14:00','14:00','14:30', 20, null),
  ('GRBNA','B5','GUD6A','ot_day','12:00','14:00','14:10','15:00','15:00','16:00', 30, null),
  ('GRBNA','B5','GUD6A','ot_day','14:00','16:00','16:10','17:00','17:00','18:00', 40, null),
  ('GRBNA','B5','GUD6A','ot_day','16:00','18:00','18:10','19:00','19:00','20:00', 50, null),
  -- ── Dock B5 · OT Night ────────────────────────────────────────────────────────
  ('GRBNA','B5','GUD6A','ot_night','20:00','22:00','22:10','23:00','23:00','00:10', 10, null),
  ('GRBNA','B5','GUD6A','ot_night','22:00','00:00','00:10','01:00','01:00','01:50', 20, null),
  ('GRBNA','B5','GUD6A','ot_night','00:00','02:00','02:10','03:00','03:00','04:00', 30, null),
  ('GRBNA','B5','GUD6A','ot_night','02:00','04:00','04:10','05:00','05:00','06:00', 40, null),
  ('GRBNA','B5','GUD6A','ot_night','04:00','06:00','06:10','07:00','07:00','08:30', 50, null)
on conflict do nothing;

/* ══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════════════
select dock_code, pattern, period_start || '-' || period_end as "ช่วงดึง", pickup_time as "รถมารับ", delivery_time
  from public.customer_pull_rounds where ship_to='GRBNA' order by dock_code, pattern, sort_order;   -- ต้องได้ 24 แถว

   ══ ROLLBACK ═══════════════════════════════════════════════════════════════════
   drop table if exists public.customer_pull_rounds;
   ⇒ โค้ดกลับไปใช้ lead_min เหมือนเดิมเอง (ตัวอ่านทน 42P01 อยู่แล้ว — ขึ้นแถบเตือนบนจอ ไม่เงียบ)
══════════════════════════════════════════════════════════════════════════════════ */
