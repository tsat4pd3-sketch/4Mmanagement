-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill oee_q/oee ของกะที่ถูกหักด้วย "ของสงสัย" ที่ QA ยังไม่ตัดสิน
-- DR project (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB")          2026-09-30
--
-- ที่มา: กฎใหม่ §7.1 ใน src/utils/oee.js (คำสั่ง user 30/09 "ให้ %Q รอผล QA")
--   ของสงสัย = ยังไม่รู้ว่าดีหรือเสีย ⇒ ไม่นับเข้า %Q จนกว่า QA จะตัดสิน
--   แต่ `production_sessions.oee_q` ถูก stamp ตอนปิดกะด้วยกฎเก่า (qty_ng + qty_suspect)
--   ⇒ ค่าที่ stamp ไว้ ≠ ค่าที่ทุกจอคำนวณใหม่ = จอเดียวกันตอบ 2 เลข (user สั่ง backfill 30/09)
--
-- ขอบเขต: ทั้งฐานมีของสงสัยแค่ 4 ใบ (71 ชิ้น) · กระทบ 3 กะ (ใบ 05/08 stamp เป็น 100 อยู่แล้ว)
--   ทั้ง 3 กะมี qty_ng = 0 ⇒ ของสงสัยเป็นตัวหัก %Q ตัวเดียว ⇒ ค่าใหม่ = 100.00
--   oee คิดใหม่จาก A × P × Q (สูตรเดียวกับ strictOee) **ห้ามคงค่า oee เดิมไว้**
--
-- 🔴 ใบที่ QA ยัง "ไม่ตัดสิน" (pending) = ค่านี้เป็น **ค่าชั่วคราว**
--    ถ้า QA ตัดสินทีหลังว่า 'scrap' ของก้อนนั้นกลายเป็นของเสีย ⇒ ต้องคิด %Q กะนั้นใหม่
--    ⇒ ตารางสำรองด้านล่างเก็บ `qa_state` ไว้ให้ session ถัดไปตามงานต่อได้
--
-- ปลอดภัย/ย้อนได้: สำรองค่าเดิมลง schema `archive` ก่อน (กฎ CLAUDE.md — สำเนาข้อมูล
--   ห้ามอยู่ใน `public` เพราะ PostgREST เปิด public ให้ anon อ่านได้) · คำสั่งย้อนอยู่ท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists archive;

create table if not exists archive.oee_q_suspect_backfill_20260930 (
  session_id   uuid primary key,
  work_date    date,
  line_name    text,
  shift        text,
  actual_qty   integer,
  suspect_qty  integer,
  qa_state     text,          -- pending = QA ยังไม่ตัดสิน · cleared = ตัดสินแล้วว่าไม่เสีย
  oee_a_old    numeric,
  oee_p_old    numeric,
  oee_q_old    numeric,
  oee_old      numeric,
  oee_q_new    numeric,
  oee_new      numeric,
  backfilled_at timestamptz not null default now(),
  note         text
);

alter table archive.oee_q_suspect_backfill_20260930 enable row level security;
-- ไม่สร้าง policy = ไม่มีใครอ่านผ่าน API ได้ (ตารางสำรอง ใช้จาก SQL Editor เท่านั้น)

/* ── 1) เก็บค่าเดิม + ค่าใหม่ลงตารางสำรอง ──────────────────────────────────
   เลือกเฉพาะกะที่ (ก) มีของสงสัย (ข) ไม่มี qty_ng ในใบเลย (ค) stamp ไว้ < 100
   เงื่อนไข (ข) สำคัญ: ถ้ากะไหนมีทั้ง NG และของสงสัย ค่าใหม่จะไม่ใช่ 100
   ⇒ ไฟล์นี้จะ **ไม่แตะ** แล้วต้องคิดรายกะ (ปัจจุบันไม่มีเคสนี้ — ยืนยันแล้ว 30/09) */
with src as (
  select s.id, s.work_date, s.line_name, s.shift, s.actual_qty,
         s.oee_a, s.oee_p, s.oee_q, s.oee,
         sum(coalesce(d.qty_ng, 0))      as ng_qty,
         sum(coalesce(d.qty_suspect, 0)) as suspect_qty,
         bool_or(b.qa_decision is not null or b.return_date is not null) as judged
  from public.production_sessions s
  join public.defect_logs d on d.session_id = s.id
  left join public.quality_bin_records b on b.defect_log_id = d.id
  where coalesce(d.qty_suspect, 0) > 0
  group by s.id, s.work_date, s.line_name, s.shift, s.actual_qty,
           s.oee_a, s.oee_p, s.oee_q, s.oee
)
insert into archive.oee_q_suspect_backfill_20260930
  (session_id, work_date, line_name, shift, actual_qty, suspect_qty, qa_state,
   oee_a_old, oee_p_old, oee_q_old, oee_old, oee_q_new, oee_new, note)
select id, work_date, line_name, shift, actual_qty, suspect_qty,
       case when judged then 'cleared' else 'pending' end,
       oee_a, oee_p, oee_q, oee,
       100.00,
       round((coalesce(oee_a, 0) * coalesce(oee_p, 0) / 100)::numeric, 2),
       'ของสงสัย ' || suspect_qty || ' ชิ้น ไม่นับเข้า %Q (กฎ §7.1 oee.js) · qty_ng ในใบ = 0'
from src
where ng_qty = 0 and coalesce(oee_q, 0) < 100
on conflict (session_id) do nothing;

/* ── 2) เขียนค่าใหม่ลงกะจริง (อ่านจากตารางสำรอง = แหล่งเดียว ไม่คำนวณซ้ำ 2 ที่) ── */
update public.production_sessions s
   set oee_q = b.oee_q_new,
       oee   = b.oee_new
  from archive.oee_q_suspect_backfill_20260930 b
 where s.id = b.session_id
   and s.oee_q = b.oee_q_old;      -- กันเขียนซ้ำ/เขียนทับค่าที่มีคนแก้ไปแล้ว

-- ── ตรวจผลหลังรัน ─────────────────────────────────────────────────────────
-- select b.work_date, b.line_name, b.shift, b.suspect_qty, b.qa_state,
--        b.oee_q_old, s.oee_q as oee_q_now, b.oee_old, s.oee as oee_now
-- from archive.oee_q_suspect_backfill_20260930 b
-- join public.production_sessions s on s.id = b.session_id
-- order by b.work_date;
--   ผลจริงหลัง apply 30/09 (ตรวจกลับแล้ว · oee ตรงกับ A×P×Q ทุกแถว):
--     16/07 LASER-345 ดึก · สงสัย 56 · pending · oee_q 90.60→100.00 · oee 89.86→99.18
--     21/07 Line 60   เช้า · สงสัย 12 · pending · oee_q 97.60→100.00 · oee 76.60→78.48
--     23/09 Assy GOR  เช้า · สงสัย  1 · cleared · oee_q 99.78→100.00 · oee 74.09→74.25
--   และ "กะที่ยังถูกหักด้วยของสงสัย" ต้องเหลือ 0:
--     select count(*) from public.production_sessions s
--       join public.defect_logs d on d.session_id = s.id
--      where coalesce(d.qty_suspect,0) > 0 and coalesce(s.oee_q,100) < 100;

-- ── ย้อนกลับ ──────────────────────────────────────────────────────────────
-- update public.production_sessions s
--    set oee_q = b.oee_q_old, oee = b.oee_old
--   from archive.oee_q_suspect_backfill_20260930 b
--  where s.id = b.session_id;
-- (ตารางสำรองเก็บไว้ได้ ไม่ต้องลบ — เป็นประวัติว่าเคย backfill อะไรไป)
