/* ═══════════════════════════════════════════════════════════════════════════
   ใบ MO ทีม MTN ให้ตรงฟอร์มกระดาษ 100%  (DR — eyhclzkifitbhbljgoav)  2026-09-15

   คำสั่ง user: "ต้องทำทั้งหมด เพราะ MTN จะใช้รูปแบบใบเดิมเหมือน 100%"
   ต้นฉบับ = ใบกระดาษ "ใบสั่งงานซ่อมบำรุง (M/O)" ที่ user ส่งมา (MO.No. MTN.2026/06-59)

   ⚠️ ทุกคอลัมน์ nullable ไม่มี default → ใบเก่าที่ไม่มีค่าพิมพ์ออกมาเป็นช่องว่างเหมือนเดิม
   ⚠️ ทีม JIG/DIE ใช้ FM-JIG-008 เหมือนเดิม ไม่กระทบ (คนละฟังก์ชันพิมพ์)
   ย้อนกลับ: drop column / drop table ได้ทั้งหมด (ไม่มีใครอ่านก่อนหน้านี้)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 1) หัวใบ: ช่องที่ฟอร์มกระดาษมีแต่ระบบไม่เคยเก็บ ── */
alter table mtn_orders add column if not exists contact_phone text;   -- เบอร์ติดต่อผู้แจ้ง
alter table mtn_orders add column if not exists pr_no text;           -- PR.No. (ช่องกริดบนฟอร์ม)
alter table mtn_orders add column if not exists io_no  text;          -- I/O.

/* จุดประสงค์ 4 แบบบนฟอร์ม — เดิมใบพิมพ์เดาจาก repair_type ได้แค่ ซ่อม/ปรับปรุง
   ที่เหลือพิมพ์ ☐ ตายตัว (บริการ/สร้าง ไม่มีทางติ๊กได้เลย) */
alter table mtn_orders add column if not exists purpose text;
alter table mtn_orders drop constraint if exists mtn_orders_purpose_chk;
alter table mtn_orders add constraint mtn_orders_purpose_chk
  check (purpose is null or purpose in ('repair', 'improve', 'service', 'build'));

/* ── 2) เวลาเริ่มลงมือซ่อมจริง ──────────────────────────────────────────────
   🔴 ฟอร์มกระดาษแยก 3 วันชัดเจน: รับแจ้ง → ผู้รับ MO → **วันที่เริ่ม/เสร็จ**
   ใบตัวอย่างจริง: รับแจ้ง 17/6 · รับ MO 22/6 · เริ่มซ่อม 21/7 13:00 · เสร็จ 14:00
   = รอ 34 วัน ซ่อมจริง 1 ชั่วโมง · เดิมใบพิมพ์เอา accept_at ไปวางช่อง "เวลาเริ่ม"
   ⇒ MTTR ที่คำนวณได้จะกลายเป็น 29 วัน ทั้งที่ช่างลงมือชั่วโมงเดียว
   คอลัมน์นี้คือ "ช่างเริ่มลงมือ" ตัวจริง — ใช้กับ MTTA/MTTR ในแท็บ ⚙️ รายอุปกรณ์ ด้วย */
alter table mtn_orders add column if not exists repair_start_at timestamptz;

/* ── 3) สาเหตุเกิดจาก (checkbox 4 หมวดบนฟอร์ม) — เดิมมีแต่ root_cause เป็นข้อความ ── */
alter table mtn_orders add column if not exists cause_category text;
alter table mtn_orders add column if not exists cause_other text;
alter table mtn_orders drop constraint if exists mtn_orders_cause_category_chk;
alter table mtn_orders add constraint mtn_orders_cause_category_chk
  check (cause_category is null or cause_category in ('man', 'method', 'part_life', 'other'));

/* ── 4) ช่องอนุมัติฝั่งผู้แจ้ง (ระบบมีแต่ฝั่งช่าง) ──────────────────────────
   ผู้จัดการต้นสังกัด = เซ็นทุกใบ · ผู้จัดการโรงงาน = เฉพาะงาน "สร้าง"
   ⚠️ เก็บเป็น "บันทึกว่าใครเซ็นเมื่อไหร่" ยังไม่ใช่ด่านอนุมัติในระบบ (ไม่เปลี่ยน workflow เดิม) */
alter table mtn_orders add column if not exists dept_manager_name text;
alter table mtn_orders add column if not exists dept_manager_at   timestamptz;
alter table mtn_orders add column if not exists dept_manager_sign text;
alter table mtn_orders add column if not exists plant_manager_name text;
alter table mtn_orders add column if not exists plant_manager_at   timestamptz;
alter table mtn_orders add column if not exists plant_manager_sign text;

/* ── 5) ท้ายใบ: เจ้าของค่าใช้จ่าย + รับมอบงาน + ความเห็นเพิ่มเติม + ผู้ประเมิน ── */
alter table mtn_orders add column if not exists cost_owner_dept text;  -- "ค่าใช้จ่ายทั้งหมดเป็นของหน่วยงาน ..."
alter table mtn_orders add column if not exists cost_mgr_name text;    -- ช่องเซ็น "ผู้จัดการ" ท้ายใบ
alter table mtn_orders add column if not exists cost_mgr_at   timestamptz;
alter table mtn_orders add column if not exists cost_mgr_sign text;
alter table mtn_orders add column if not exists extra_comment text;    -- ความคิดเห็นเพิ่มเติม
alter table mtn_orders add column if not exists satisfaction_by text;  -- ลงชื่อผู้ประเมินความพึงพอใจ

/* ── 6) ราคาอะไหล่รายรายการ (ฟอร์มมีคอลัมน์ "ราคา" ต่อแถว) ────────────────
   เดิมเก็บแค่ยอดรวม parts_cost ที่พิมพ์มือ ⇒ ใบตัวอย่าง (เต้ารับ 440 · ฝาครอบ 80 ·
   บล็อกลอย 60 = 580) ลงรายรายการไม่ได้ · unit_price ดึง default จาก mtn_spare_parts.unit_price */
alter table mtn_order_parts add column if not exists unit_price numeric;
alter table mtn_order_parts add column if not exists amount     numeric;

/* ── 7) ตารางค่าแรงรายคน (ฟอร์มมี 5 แถว: ชื่อ | ค่าแรง/ชม. | ราคา) ────────
   เดิมมีแค่ labor_cost ก้อนเดียว ⇒ "นาย ก 100×1.0 + นาย ข 100×1.0 = 200" ลงไม่ได้
   เรทมาตรฐานบนฟอร์ม: วิศวกร 200 บาท/ชม. · ช่างเทคนิค 100 บาท/ชม. (master mtn_labor_rates) */
create table if not exists mtn_order_labor (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references mtn_orders(id) on delete cascade,
  seq           int  not null default 1,
  worker_name   text,
  rate_per_hour numeric,
  hours         numeric,
  amount        numeric,          -- ราคาที่เขียนบนใบ (ปกติ = rate × hours)
  logged_by     text,
  created_at    timestamptz not null default now()
);
create index if not exists mtn_order_labor_order_idx on mtn_order_labor(order_id);

alter table mtn_order_labor enable row level security;
/* anon-open ชุดเดียวกับ mtn_order_parts — supabaseDR วิ่งด้วย role anon เสมอ
   (กฎเหล็ก CLAUDE.md: ห้ามตั้ง TO authenticated ฝั่ง DR) */
drop policy if exists mtn_order_labor_all on mtn_order_labor;
create policy mtn_order_labor_all on mtn_order_labor
  for all to anon, authenticated using (true) with check (true);

/* ── 8) ผู้อนุมัติ MO ฝั่งซ่อมบำรุง (ช่องกลางใบ) ────────────────────────────
   ฟอร์มมีลายเซ็น ผจก.ส่วนซ่อมบำรุง **2 จุด คนละวัน** (ใบตัวอย่าง: 22/6 กับ 17/8)
     · กลางใบ "ผู้อนุมัติ (ผจก.ส่วนซ่อมบำรุง)" = อนุมัติให้เดินงาน (คู่กับผู้รับ MO)
     · ท้ายใบ "รับรองโดย (ผจก.ส่วนซ่อมบำรุง)"  = รับรองงานเสร็จ/ค่าใช้จ่าย → ใช้ approve_* (ขั้น 7) เดิม
   ⇒ ต้องมีชุดของกลางใบแยก ไม่งั้นพิมพ์ชื่อเดียวกัน 2 ที่ทั้งที่คนละจังหวะ */
alter table mtn_orders add column if not exists mo_approved_by   text;
alter table mtn_orders add column if not exists mo_approved_at   timestamptz;
alter table mtn_orders add column if not exists mo_approve_sign  text;
