-- ══════════════════════════════════════════════════════════════════════════
-- ส่งต่องานข้ามทีมช่าง — **ปิดใบเดิม + เปิดใบใหม่ของทีมปลายทาง**      2026-09-14 (รอบ 2)
-- Project: DR (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB")
--
-- ที่มา (คำสั่ง user — แก้โมเดลที่เพิ่งทำเมื่อเช้า):
--   "เคสที่ผลิตเข้าไป take action ก่อนแล้วแก้ไม่ได้ ให้จบเลขของผลิต แล้วเมื่อส่งต่อไปช่างเฉพาะทาง
--    ให้เปิดเลขใหม่ของส่วนงานนั้นๆ แต่อาจจะให้มีการ relate กันได้ · เลขของผลิตก็ตัดจบแค่ขั้นตอนนั้น
--    ว่าไม่สามารถแก้ไขได้ ส่งต่อหน่วยงานอื่น · เก็บเป็นประวัติไว้ว่าเข้าไป action ก่อนแล้วกี่ครั้ง
--    ทำเองได้/ไม่ได้กี่ครั้ง"
--
-- โมเดลเดิม (รอบเช้า) = **ย้ายใบ** (เปลี่ยน mtn_dept, ใช้เลข MO เดิม, ล้างช่องทำงานของทีมเดิม)
--   ปัญหา 3 ข้อที่ทำให้ต้องเปลี่ยน:
--     1. เลข MO ขึ้นต้นด้วยรหัสทีมแรก (PRD-…) ทั้งที่ทีมที่ซ่อมจริงคือ MTN ⇒ สถิติ/KPI รายทีมปนกัน
--     2. ต้องล้าง root_cause/solution/ช่าง ของทีมเดิมทิ้งแล้วเก็บ snapshot แยก = ซับซ้อนและเสี่ยงข้อมูลหาย
--     3. **วัดไม่ได้ว่า first-response ของช่างฝ่ายผลิตแก้เองได้กี่ %** — ใบเดียวจบที่ทีมหลัง
--   โมเดลใหม่ = **1 ปัญหา หลายใบ ผูกกันเป็นสาย** ⇒ แต่ละใบเป็นของทีมนั้นจริง นับสถิติแยกได้
--   (ตรงกับผังทางการด้วย: "แจ้ง**ขอเปิด**ส่งต่อให้หน่วยงานรับผิดชอบ" = เปิดใบ ไม่ใช่ย้ายใบ)
--
-- ⚠️ สถานะใหม่ `transferred` = "ใบนี้จบแล้วเพราะส่งต่อให้ทีมอื่น (ทีมนี้แก้ไม่ได้)"
--   **ไม่ใช่ closed** (closed = ซ่อมเสร็จและอนุมัติปิด — นับเป็นผลงานสำเร็จ) และ**ไม่ใช่ rejected**
--   (rejected = ใบไม่ถูกต้อง) · `mtn_orders.status` ไม่มี check constraint จึงรับค่าใหม่ได้ทันที
--   · `OPEN_MO_STATUSES` (src/utils/dieStatus.js) เป็น **allowlist** ⇒ Andon/DieRegistry/FactoryMap
--     กันใบ transferred ออกจากคิวเปิดให้เองอยู่แล้ว ไม่ต้องแก้
--   · จุดที่ใช้ **denylist** `!['closed','rejected']` ต้องแก้ให้รู้จัก transferred — รวบเป็น
--     `MO_DONE_STATUSES`/`isMoOpen()` ที่ `src/utils/mtnStepPerm.js` ที่เดียว (คอมมิทเดียวกัน)
-- ══════════════════════════════════════════════════════════════════════════

-- 1) โครงตารางเชื่อมใบ — เปลี่ยนความหมายจาก "snapshot ตอนย้ายใบ" เป็น "ใบเดิม → ใบใหม่"
--    ปลอดภัยที่จะ drop: สร้างเมื่อเช้าวันนี้และยังไม่มีใครใช้ (0 แถว) ตรวจแล้วก่อนรัน
drop table if exists public.mtn_order_handoffs;

create table public.mtn_order_handoffs (
  id            uuid primary key default gen_random_uuid(),
  from_order_id uuid not null references public.mtn_orders(id) on delete cascade,
  to_order_id   uuid          references public.mtn_orders(id) on delete set null,
  from_dept     text,
  to_dept       text not null,
  reason        text not null,          -- ทีมแรกติดตรงไหน (บังคับกรอก — ทีมใหม่ต้องอ่านได้)
  handed_by     text,
  handed_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists mtn_handoffs_from_idx on public.mtn_order_handoffs (from_order_id);
create index if not exists mtn_handoffs_to_idx   on public.mtn_order_handoffs (to_order_id);

comment on table public.mtn_order_handoffs is
  'สายการส่งต่อใบซ่อมข้ามทีม (2026-09-14 รอบ 2) — 1 แถว = ใบเดิม(from) ถูกปิดเป็น transferred แล้วเปิดใบใหม่(to) ให้ทีมปลายทาง · ไม่เก็บ snapshot ผลตรวจแล้ว เพราะใบเดิมไม่ถูกล้าง อ่านจากใบเดิมได้ตรงๆ';

-- 2) ตัวชี้กลับบนใบลูก — ให้การ์ด/ลิสต์โชว์ชิป "ส่งต่อมาจาก MO-xxx" ได้โดยไม่ต้อง join
--    เก็บเป็น "เลข MO" (snapshot ข้อความ) ไม่ใช่ FK — ใบเดิมอาจยังไม่ออกเลขตอนส่งต่อก็ได้
alter table public.mtn_orders add column if not exists transferred_from_mo text;
comment on column public.mtn_orders.transferred_from_mo is
  'เลข MO ของใบก่อนหน้าในสายการส่งต่อ (2026-09-14) — รายละเอียดเต็มอยู่ใน mtn_order_handoffs';

-- 3) ตัวนับของโมเดลเก่าไม่ใช้แล้ว (ใบเดิมจบเลย ไม่ถูกส่งต่อซ้ำ) — ความยาวสายดูจากตารางเชื่อมแทน
alter table public.mtn_orders drop column if exists handoff_count;

/* RLS — DR project: client (`supabaseDR`) วิ่งด้วย role `anon` เสมอ ไม่มี JWT
   ⇒ ต้องเปิดให้ anon ไม่งั้นพังเงียบ (กฎเหล็ก CLAUDE.md) · เปิดเฉพาะ select + insert
   ประวัติการส่งต่อเป็นหลักฐานว่าใครส่งอะไรต่อให้ใคร — แก้/ลบไม่ได้
   ยกเว้น update `to_order_id` ไม่เปิด: client insert ครบทั้งแถวในครั้งเดียว (สร้างใบลูกก่อนแล้วค่อย insert) */
alter table public.mtn_order_handoffs enable row level security;
drop policy if exists mtn_order_handoffs_read  on public.mtn_order_handoffs;
drop policy if exists mtn_order_handoffs_write on public.mtn_order_handoffs;
create policy mtn_order_handoffs_read  on public.mtn_order_handoffs for select using (true);
create policy mtn_order_handoffs_write on public.mtn_order_handoffs for insert with check (true);

-- ตรวจผลหลังรัน (DR · Product DB):
--   select column_name from information_schema.columns where table_name='mtn_order_handoffs' order by ordinal_position;
--   select count(*) from information_schema.columns where table_name='mtn_orders' and column_name='transferred_from_mo';  -- 1
--   select count(*) from information_schema.columns where table_name='mtn_orders' and column_name='handoff_count';        -- 0
--   -- สถิติ first-response ของช่างฝ่ายผลิต (หลังเริ่มใช้จริง):
--   select count(*) filter (where status='transferred') as ส่งต่อ,
--          count(*) filter (where status='closed')      as แก้เองจบ
--     from mtn_orders where mtn_dept='production' and repair_done_at is not null;
--
-- Rollback:
--   drop table if exists public.mtn_order_handoffs;
--   alter table public.mtn_orders drop column if exists transferred_from_mo;
--   alter table public.mtn_orders add column if not exists handoff_count int not null default 0;
--   update public.mtn_orders set status='repaired' where status='transferred';   -- คืนใบที่ส่งต่อไปแล้ว
