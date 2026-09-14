-- ══════════════════════════════════════════════════════════════════════════
-- ใบซ่อม MO — ส่งต่องานให้ทีมช่างที่เกี่ยวข้อง (ไม่ต้องเปิดใบใหม่)      2026-09-14
-- Project: DR (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB")
--
-- ที่มา (คำสั่ง user 2026-09-14):
--   "หาปัญหาไหนที่ช่างฝ่ายผลิตเข้าไป action ในรอบแรกและไม่สามารถแก้ไขได้ สามารถส่งใบต่อไปให้
--    ช่างส่วนที่เกี่ยวข้องดำเนินงานต่อ โดยเห็นรายละเอียดจากช่างฝ่ายผลิตที่เข้าไปดูอาการเบื้องต้นมาก่อนแล้ว
--    เหมือนส่งต่องาน · ตอนนี้กลายเป็นว่าพนักงานจะเปิดใบใหม่ไปให้ช่างเฉพาะทางอีก"
--   ตรงกับผังกระบวนการทางการ: กล่อง "แก้ไขได้? → ไม่ใช่ → หน่วย Support PD แจ้งขอเปิดส่งต่อให้
--   หน่วยงานรับผิดชอบ" (สายช่าง PD) และ "→ MTN แจ้งเปิด Case Vendor" (สาย MTN)
--
-- ทำไมต้องเป็นกลไกใหม่ ไม่ใช่ขยาย "ตีกลับ" (canBounceBack):
--   ตีกลับถูกล็อกไว้ที่ `current_step <= 2` โดยตั้งใจ เพราะมันถอยใบไปขั้น 1 ⇒ **ผลงาน/ลายเซ็นขั้น 3
--   หายจากสายตา** · การส่งต่อเกิดหลังช่างลงมือดูแล้ว (ขั้น 3) จึงต้อง **เก็บผลตรวจเบื้องต้นไว้**
--   แล้วค่อยส่งให้ทีมใหม่ — คนละความหมาย คนละตาราง
--
-- ขนาดปัญหา (วัดจริง 14/09): ใบทีม `production` (ช่างฝ่ายผลิต first-response) = 291 ใบ = **91%**
--   ของใบทั้งหมด ⇒ ทางที่ขาดนี้คือทางที่คนเดินบ่อยที่สุด
--
-- ⚠️ เลข MO เดิมถูกเก็บไว้ (ไม่ออกเลขใหม่) — ใบเดียวกัน งานเดียวกัน สอบกลับได้เส้นเดียว
--   ผลข้างเคียงที่ยอมรับ: รหัสทีมใน mo_no ยังเป็นของทีมแรก (เช่น PRD-...) ทั้งที่ทีมที่ทำจริงคือ MTN
--   → ดูทีมปัจจุบันจาก `mtn_orders.mtn_dept` เสมอ **ห้ามอ่านทีมจาก prefix ของ mo_no**
--   (`mtn_assign_mo_no` เป็น idempotent อยู่แล้ว ทีมใหม่กดขั้น 2 จึงไม่ได้เลขใหม่)
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.mtn_order_handoffs (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.mtn_orders(id) on delete cascade,
  seq            int  not null default 1,          -- ส่งต่อครั้งที่เท่าไหร่ของใบนี้
  from_dept      text,                             -- ทีมที่ส่งต่อ (key ใน mtn_teams)
  to_dept        text not null,                    -- ทีมปลายทาง
  reason         text not null,                    -- ทำไมถึงแก้เองไม่ได้ (บังคับกรอก)
  handed_by      text,
  handed_at      timestamptz not null default now(),
  -- 🔎 snapshot "ผลตรวจเบื้องต้น" ของทีมที่ส่งต่อ — ทีมใหม่ต้องเห็นว่าเขาเจออะไรมาแล้ว
  found_root_cause text,
  found_solution   text,
  found_after_img  text,
  tech_main        text,
  tech_secondary   text,
  accept_at        timestamptz,                    -- ทีมเดิมรับงานเมื่อไหร่ (ไว้คิดเวลาที่ใช้ไป)
  repair_done_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists mtn_order_handoffs_order_idx on public.mtn_order_handoffs (order_id, seq);

-- ตัวนับบนใบ — ใช้โชว์ชิป "➡️ ส่งต่อมาแล้ว N ครั้ง" โดยไม่ต้อง join ทุกแถวในลิสต์
alter table public.mtn_orders add column if not exists handoff_count int not null default 0;

comment on table  public.mtn_order_handoffs is
  'ประวัติการส่งต่อใบซ่อมข้ามทีมช่าง (2026-09-14) — 1 แถว = 1 ครั้งที่ส่งต่อ พร้อม snapshot ผลตรวจเบื้องต้นของทีมเดิม';
comment on column public.mtn_orders.handoff_count is
  'จำนวนครั้งที่ใบนี้ถูกส่งต่อข้ามทีม (2026-09-14) — รายละเอียดอยู่ใน mtn_order_handoffs';

/* RLS — ตาม convention ฝั่ง DR: client (`supabaseDR`) วิ่งด้วย role `anon` เสมอ ไม่มี JWT
   ⇒ policy ต้องเปิดให้ anon ไม่งั้นฟีเจอร์พังเงียบทันที (กฎเหล็กใน CLAUDE.md — เคยทำพังมาแล้ว)
   ครบทุก cmd ที่ client ใช้จริง: select (แสดงผลตรวจเบื้องต้น) + insert (ตอนกดส่งต่อ)
   ไม่เปิด update/delete — ประวัติการส่งต่อต้องแก้ไม่ได้ (เป็นหลักฐานว่าใครส่งอะไรต่อให้ใคร) */
alter table public.mtn_order_handoffs enable row level security;

drop policy if exists mtn_order_handoffs_read  on public.mtn_order_handoffs;
drop policy if exists mtn_order_handoffs_write on public.mtn_order_handoffs;
create policy mtn_order_handoffs_read  on public.mtn_order_handoffs for select using (true);
create policy mtn_order_handoffs_write on public.mtn_order_handoffs for insert with check (true);

-- ตรวจผลหลังรัน (DR · Product DB):
--   select count(*) from mtn_order_handoffs;                                   -- 0 (ยังไม่มีใครส่งต่อ)
--   select column_name from information_schema.columns
--    where table_name='mtn_orders' and column_name='handoff_count';            -- ต้องเจอ 1 แถว
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.mtn_order_handoffs'::regclass;                   -- ต้องมี select + insert
--
-- Rollback:
--   drop table if exists public.mtn_order_handoffs;
--   alter table public.mtn_orders drop column if exists handoff_count;
