-- ═══════════════════════════════════════════════════════════════════════════════
-- break_line_rules — "ไลน์นี้พักรายการนี้กี่นาที" (ข้อยกเว้นรายไลน์)
-- Project: DR / "Product DB" (eyhclzkifitbhbljgoav)
-- วันที่: 2026-10-20 · ที่มา: feedback หน้างาน
--   *"บางไลน์เค้าทำ5สก่อนเลิกงานแค่ 10นาที หรือ5นาทีก็มี"*
--
-- โครงเดิม `break_policies` มี 4 แกน (กะ / กระบวนการ / ot_scope / anchor) แต่ **ไม่มีแกนไลน์**
-- ⇒ 5ส. = 20 นาทีเท่ากันทั้ง 36 ไลน์ · ไลน์ที่ทำจริง 10 นาทีถูกหักฐานเวลาเกิน 10 นาที
--   = %A/%P ต่ำกว่าจริงทุกกะ (และกลับกันถ้าไลน์ทำนานกว่า)
--
-- กติกา (เคาะกับ user 20/10):
--   · ตั้งทับได้ **ทุกรายการพัก** ไม่ใช่เฉพาะ 5ส.
--   · **ไลน์ลูกได้ตามไลน์แม่** — ตั้งที่ไลน์แม่ครั้งเดียว ลูกใต้มันได้ตามกันหมด
--     ถ้าลูกตัวไหนตั้งเองไว้ **ตัวเองชนะแม่** (กฎเดียวกับ "ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ")
--     ⇒ ไล่สายขึ้นที่ `src/utils/breakLineRules.js` **ที่เดียว** ไม่ใช่ที่ DB
--   · ไลน์ที่ไม่มีแถวที่นี่ = ใช้ค่ากลางของ `break_policies` **เหมือนวันนี้เป๊ะ**
--   · `duration_min = 0` = "ไลน์นี้ไม่มีพักรายการนี้" (ค่าที่ตั้งใจได้ ไม่ใช่ค่าว่าง)
--
-- ⚠️ ไม่มีคอลัมน์ `offset_min`: พักที่ `anchor='shift_end'` เลื่อนให้เองโดย **รักษาระยะถึงปลายกะ**
--    (gap = offset − duration ของค่ากลาง) ⇒ กลางตั้ง 20/20 (จบพอดีเลิกกะ) · ไลน์ตั้ง 10 → 10 นาทีสุดท้าย
--    ถ้าเพิ่มคอลัมน์ไว้โดยไม่มีช่องบนจอ = ช่องตายที่ไม่มีใครกรอก (ผิดกฎโปรเจค) — รอมีเคสจริงก่อน
--
-- blast radius: ตารางใหม่ล้วน ไม่มีใครอ่านจนกว่าโค้ด deploy · ว่างเปล่า = พฤติกรรมเดิม 100%
-- rollback: บล็อกท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.break_line_rules (
  id            uuid primary key default gen_random_uuid(),
  policy_id     uuid not null references public.break_policies(id) on delete cascade,
  line_name     text not null,
  duration_min  integer not null,
  note          text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint break_line_rules_dur_chk check (duration_min >= 0 and duration_min <= 480)
);

-- 🔑 คีย์ของ upsert ต้องเป็น unique index **คอลัมน์ล้วน** ห้าม expression/partial (42P10 = ไม่เขียนเลยทั้งก้อน)
create unique index if not exists break_line_rules_policy_line_uk
  on public.break_line_rules (policy_id, line_name);

create index if not exists break_line_rules_line_idx
  on public.break_line_rules (line_name);

comment on table  public.break_line_rules is
  'ข้อยกเว้นรายไลน์ของ break_policies — "ไลน์นี้พักรายการนี้กี่นาที" · ไลน์ลูกตกทอดจากไลน์แม่ (ไล่สายที่ src/utils/breakLineRules.js) · ไม่มีแถว = ใช้ค่ากลาง';
comment on column public.break_line_rules.line_name is
  'ชื่อไลน์ตาม production_lines.name (จับคู่ด้วยข้อความ ไม่ผูก FK — คนละ project) · ตั้งที่ไลน์แม่ = ลูกได้ตามกัน';
comment on column public.break_line_rules.duration_min is
  'นาทีพักของไลน์นี้ · 0 = ไลน์นี้ไม่มีพักรายการนี้ · พักท้ายกะเลื่อนให้เองโดยรักษาระยะถึงปลายกะ';

-- RLS — 🔴 ฝั่ง DR วิ่งด้วย role anon เสมอ (ไม่มี JWT) ห้าม TO authenticated
-- มิเรอร์ของ break_policies เป๊ะ (policy เดียว cmd ALL · using/check = true)
alter table public.break_line_rules enable row level security;
drop policy if exists allow_all_break_line_rules on public.break_line_rules;
create policy allow_all_break_line_rules on public.break_line_rules
  for all using (true) with check (true);

/* ── ROLLBACK ────────────────────────────────────────────────────────────────────
   ย้อนได้ทันที (ไม่มีใครอ่านตารางนี้นอกจากโค้ดเวลาพัก — ทิ้งแถว = กลับไปใช้ค่ากลาง):

     drop table if exists public.break_line_rules;

   ถ้าต้องการเก็บข้อมูลไว้ก่อน:
     create schema if not exists archive;
     create table archive.break_line_rules_20261020 as select * from public.break_line_rules;
     drop table public.break_line_rules;
   ลำดับที่ปลอดภัย: revert โค้ดก่อน (จอกลับไปอ่านแค่ break_policies) → แล้วค่อย drop
──────────────────────────────────────────────────────────────────────────────── */
