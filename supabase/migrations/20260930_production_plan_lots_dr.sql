-- 📋 แผนสั่งงานรายล็อต — ทีมวางแผนจัดคิวให้ฝ่ายผลิต (DR "Product DB" · eyhclzkifitbhbljgoav · 2026-09-30)
--
-- ⭐ ที่มา (คำสั่ง user 2026-09-30): *"เราต้องการหน้าที่เอาไว้ให้หน่วยงานวางแผน จัดแผนการผลิตให้กับ
--    ฝ่ายผลิต สำหรับพวกงาน lot size ที่ไม่ได้ผลิตตาม KANBAN แบบ first come first serve
--    ต้องมีการวิเคราะห์และจัดการโดยทีมวางแผน"*
--
-- 🔍 ทำไมต้องมีตารางใหม่ (วัดจากฐานจริง 2026-09-30):
--   · `prod_orders.session_id` เป็น **NOT NULL** ⇒ ใบผลิตเกิดได้เฉพาะ "หลังเปิดกะแล้ว" เท่านั้น
--     ⇒ ทีมวางแผนออกใบล่วงหน้าไม่ได้เลยโดยโครงสร้าง · และไม่มีคอลัมน์วันที่วางแผน/ลำดับคิว/ผู้วางแผน
--   · ลำดับงานบนบอร์ดทุกวันนี้ = เรียงตาม `opened_at` = **เวลาที่หน้างานสแกนเปิด** (first come first serve)
--   · 30 วันล่าสุด — 9 ไลน์ที่ใบผลิตเป็น manual **100%** (ไม่มีคัมบังให้สแกน หน้างานเปิดใบเอง):
--     SUB APRON 439 ใบ · HDF1 74 · LASER-345 74 · LASER-789 43 · Laser GOR 43 · Laser LWR 41 ·
--     HDF2 41 · LASER E50 30 · BENDING E50 23  (รวม 808 ใบ)
--     และไลน์ปั๊มที่เดินเป็นล็อต/แคมเปญ: LINE A 60 ใบใน **5 วัน** · LINE B 70/5 วัน · LINE C 39/3 วัน
--     (เทียบไลน์คัมบัง Line 60/61 · Assy GOR/LWR = manual 0–0.6% ⇒ ของเดิมพอแล้ว ไม่ต้องแตะ)
--
-- 🔴 ทำไม**ไม่**แก้ `prod_orders` ให้ session_id เป็น null ได้:
--   ทั้งระบบ join `production_sessions!inner` เพื่อเอา line_name/work_date (prod_orders ไม่มี 2 คอลัมน์นี้)
--   ⇒ แถวที่ไม่มี session จะหายจากทุกจอเงียบๆ (OEE · บอร์ด · รายงาน · flow-tower)
--   ⇒ แยกตารางแทน = ของเดิมไม่เปลี่ยนพฤติกรรมเลยแม้แต่แถวเดียว · rollback = drop table จบ
--
-- 🔒 RLS: ตาม pattern ของ DR ทั้ง project — `allow all` ให้ public
--   ⚠️ **ห้ามใช้ `has_perm()` / `TO authenticated` กับตารางฝั่ง DR** — `supabaseDR` สร้างด้วย anon key
--      ไม่มี JWT เลย (กฎเหล็ก CLAUDE.md · เคยทำพังทั้งระบบมาแล้ว) · สิทธิ์คุมที่ client ด้วย `can()`
--
-- 🔙 rollback: drop table if exists public.production_plan_lots;
--    (ไม่มี FK ชี้เข้ามา · ไม่มีตารางอื่นพึ่งพา · prod_orders ไม่ถูกแก้แม้แต่คอลัมน์เดียว)

create table if not exists public.production_plan_lots (
  id              uuid primary key default gen_random_uuid(),

  -- ── "แผนนี้ของไลน์ไหน วันไหน กะไหน ลำดับที่เท่าไหร่" ──
  work_date       date not null,
  shift           text not null check (shift in ('day','night')),
  line_name       text not null,
  seq             integer not null default 1,      -- ลำดับในกะนั้น (1 = ทำก่อน)

  -- ── งานที่สั่ง ──
  mat_no          text not null,
  part_name       text,
  qty_plan        integer not null check (qty_plan > 0),

  -- ── ทรัพยากรที่ระบุ (คำสั่ง user: "เพิ่มเครื่อง/แม่พิมพ์ด้วย") ──
  machine_no      text,          -- เลขเครื่อง — ต้องผ่าน snapMachineNo ฝั่ง client (กฎ machine_no)
  die_no          text,          -- รหัสแม่พิมพ์ (die_sets.die_no) — ใช้คิดเวลาเปลี่ยนรุ่นผ่าน pressSetup.js

  -- ── สถานะ ──
  --   planned   = วางแผนไว้ ยังไม่ถึงคิว
  --   started   = หน้างานกดเริ่มแล้ว (ผูก prod_order_id)
  --   done      = ใบผลิตที่ผูกไว้ถูกปิดแล้ว
  --   cancelled = ยกเลิก (ต้องมีเหตุผล — ห้ามลบแถวทิ้งเพื่อให้สอบกลับได้)
  status          text not null default 'planned'
                  check (status in ('planned','started','done','cancelled')),
  prod_order_id   uuid,          -- ใบผลิตจริงที่เกิดจากล็อตนี้ (null = ยังไม่เริ่ม)
  cancel_reason   text,

  -- ── ที่มา/บริบทของการตัดสินใจ ──
  due_date        date,          -- ดิวลูกค้าที่ล็อตนี้รองรับ (ไว้ตีสีว่าสายมั้ย) · null = ไม่ผูกดิวตรงๆ
  source          text not null default 'manual' check (source in ('manual','auto')),
                                 -- auto = ระบบเสนอมาแล้วคนกดรับ (กติกา "ระบบเสนอ คนตัดสิน")
  -- 🔴 เวลาเปลี่ยนรุ่นที่ประเมินได้ ณ ตอนวางแผน (นาที) — **null = ตอบไม่ได้ ห้ามตีเป็น 0**
  --    (กฎเหล็ก pressSetup.js: ไม่มีกฎ/ไม่รู้เวลาฐาน = null · 0 จะทำให้แผนดูดีเกินจริงแล้วคนเชื่อ)
  setup_min_est   numeric,
  note            text,

  -- ── audit (ตารางนี้อยู่ใน DR_AUDIT_TABLES ⇒ wrapper stamp updated_by_* ให้อัตโนมัติ) ──
  planned_by      text,
  planned_by_uid  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  updated_by_uid  uuid
);

comment on table public.production_plan_lots is
  'แผนสั่งงานรายล็อตที่ทีมวางแผนออกให้ฝ่ายผลิต (งาน lot size ที่ไม่ได้เดินตามคัมบัง) · หน้างานกด "เริ่ม" แล้วระบบสร้าง prod_orders ให้ · 2026-09-30';
comment on column public.production_plan_lots.seq is 'ลำดับในกะ (1 = ทำก่อน) — ระบบเสนอลำดับที่เสียเวลาเปลี่ยนแม่พิมพ์น้อยสุด แต่คนวางแผนแก้ทับได้เสมอ';
comment on column public.production_plan_lots.setup_min_est is
  'เวลาเปลี่ยนรุ่นที่ประเมินได้ตอนวางแผน (นาที) · null = ข้อมูลไม่พอให้ตอบ **ห้ามอ่านเป็น 0** (กฎเหล็ก pressSetup.js)';
comment on column public.production_plan_lots.prod_order_id is
  'ใบผลิตจริงที่เกิดจากล็อตนี้ · ไม่ผูก FK ข้ามด้วย on delete เพราะใบผลิตมีวงจรชีวิตของตัวเอง (ยกยอด/เปิดซ้ำ)';

-- ── index ตามทางที่จอถามจริง ──
create index if not exists idx_plan_lots_board   on public.production_plan_lots (work_date, line_name, shift, seq);
create index if not exists idx_plan_lots_order   on public.production_plan_lots (prod_order_id) where prod_order_id is not null;
create index if not exists idx_plan_lots_open    on public.production_plan_lots (work_date, status) where status in ('planned','started');
create index if not exists idx_plan_lots_mat     on public.production_plan_lots (mat_no, work_date);

-- 🔴 กันแผนซ้ำใบเดียวกัน: 1 ใบผลิต ผูกได้กับล็อตเดียว (ไม่งั้นยอดถูกนับ 2 รอบตอนเทียบแผน↔จริง)
create unique index if not exists uq_plan_lots_prod_order
  on public.production_plan_lots (prod_order_id) where prod_order_id is not null;

alter table public.production_plan_lots enable row level security;

-- ⚠️ pattern เดียวกับ prod_orders / production_sessions ของ project นี้ (anon-open — ดูหัวไฟล์)
drop policy if exists "allow all production_plan_lots" on public.production_plan_lots;
create policy "allow all production_plan_lots" on public.production_plan_lots
  for all to public using (true) with check (true);

-- ── updated_at อัตโนมัติ ──
create or replace function public.tg_plan_lots_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_plan_lots_touch on public.production_plan_lots;
create trigger trg_plan_lots_touch before update on public.production_plan_lots
  for each row execute function public.tg_plan_lots_touch();

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select count(*) from public.production_plan_lots;
-- select policyname, cmd from pg_policies where tablename = 'production_plan_lots';
