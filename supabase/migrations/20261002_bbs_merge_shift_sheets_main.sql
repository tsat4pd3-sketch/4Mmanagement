-- ════════════════════════════════════════════════════════════════════════════
-- BBS: ยุบใบที่แยกตามกะ → 1 ใบต่อ (เดือน × ไลน์)   · Main project (ewhdfqwfwofivojtsizn "MAIN")
-- 2026-10-02 · คำสั่ง user: "ไม่แยกก็ไม่ต้องมีให้กรอง"
--
-- ที่มา: `bbs_sheets` unique เดิม = (month_key, line_name, shift) ⇒ ปุ่มกะบนจอเป็น "คีย์ของใบ"
--   ไม่ใช่ตัวกรอง · พอป้าย `''` ถูกกวาดเป็น "ทุกกะ" (78119fb6) ผู้ใช้อ่านว่าเป็นตัวกรอง
--   เลยกรอกกระจาย 3 ถัง (ทั้งวัน/กะเช้า/กะดึก) ของเดือน+ไลน์เดียวกัน
--   → user ตัดสิน: **BBS ไม่แยกกะ** ⇒ ยุบใบ + ถอดปุ่มกะออกจากจอในคอมมิทเดียวกัน
--
-- 📊 วัดก่อนรัน (02/10): obs 5,487 แถว → 4,660 ช่องหลังรวม
--   · ช่องที่ชนกัน 827 — **เหมือนกันเป๊ะ 826** (mark + agreement_seq ตรงกัน = คนกรอกซ้ำของเดิม)
--   · ต่างกันจริง **1 ช่อง** = Line 60 ส.ค. วันที่ 25 → `ทั้งวัน = ok (คนกรอก)` vs `กะเช้า = na (ระบบเติม)`
--     ⇒ ตัดสินด้วยกฎข้อ 1 ("ไม่ได้ตรวจ" แพ้ของที่ตรวจจริง) · **ไม่มีช่องไหนที่ขัดกันแบบต้องให้คนตัดสิน**
--   · `bbs_row_notes` = 0 แถว (ไม่มีอะไรให้รวม — เขียนไว้ให้ครบเผื่ออนาคต)
--
-- 🧭 กฎรวมช่อง (เรียงตามลำดับ) — ห้ามสลับลำดับ:
--   1) `mark <> 'na'` ชนะ  — "ไม่ได้ตรวจ" ไม่ใช่ผลตรวจ
--   2) `source = 'manual'` ชนะ `'ppe'` — คนกรอกเองชนะระบบเติม
--   3) `updated_at` ใหม่กว่าชนะ
--
-- 🔙 ROLLBACK: สำเนาเต็มก่อนแก้อยู่ใน schema `archive` (ตามกฎ CLAUDE.md ห้ามวางสำเนาใน public)
--   `archive.bbs_sheets_pre_merge_20261002` · `archive.bbs_observations_pre_merge_20261002`
--   `archive.bbs_row_notes_pre_merge_20261002` · แผนที่ใบผู้รอด `archive.bbs_merge_map_20261002`
--   คืนค่า: drop index ใหม่ → ลบของ public → insert กลับจาก archive → สร้าง index เดิม
--   (`create unique index bbs_sheet_uniq on public.bbs_sheets (month_key, line_name, shift)`)
--
-- หมายเหตุ: **คอลัมน์ `shift` ไม่ถูกลบ** (additive / backward-compatible) — เหลือเป็น vestigial
--   ค่า `''` ทุกแถว · โค้ดเวอร์ชันเก่าที่ยัง query `.eq('shift','')` จึงยังอ่านใบได้เหมือนเดิม
-- ════════════════════════════════════════════════════════════════════════════

begin;

create schema if not exists archive;

-- ── 0) สำเนาเต็มก่อนแตะอะไร ────────────────────────────────────────────────
create table if not exists archive.bbs_sheets_pre_merge_20261002       as select * from public.bbs_sheets;
create table if not exists archive.bbs_observations_pre_merge_20261002 as select * from public.bbs_observations;
create table if not exists archive.bbs_row_notes_pre_merge_20261002    as select * from public.bbs_row_notes;

-- ── 1) เลือก "ใบผู้รอด" ต่อ (เดือน, ไลน์) = ใบที่มีช่องกรอกเยอะสุด (เก่าสุดชนะเมื่อเท่ากัน) ──
create table if not exists archive.bbs_merge_map_20261002 as
with cnt as (select sheet_id, count(*) c from public.bbs_observations group by 1)
select distinct on (s.month_key, s.line_name)
       s.id as survivor_id, s.month_key, s.line_name
from public.bbs_sheets s
left join cnt on cnt.sheet_id = s.id
order by s.month_key, s.line_name, coalesce(cnt.c, 0) desc, s.created_at asc, s.id asc;

-- ── 2) ย้ายช่องที่ใบผู้รอด "ยังไม่มี" ────────────────────────────────────────
insert into public.bbs_observations
       (sheet_id, employee_id, day, mark, agreement_seq, note, source, updated_by_name)
select distinct on (m.survivor_id, o.employee_id, o.day)
       m.survivor_id, o.employee_id, o.day, o.mark, o.agreement_seq, o.note, o.source, o.updated_by_name
from public.bbs_observations o
join public.bbs_sheets s on s.id = o.sheet_id
join archive.bbs_merge_map_20261002 m on m.month_key = s.month_key and m.line_name = s.line_name
where o.sheet_id <> m.survivor_id
  and not exists (
    select 1 from public.bbs_observations t
    where t.sheet_id = m.survivor_id and t.employee_id = o.employee_id and t.day = o.day)
order by m.survivor_id, o.employee_id, o.day,
         (o.mark <> 'na') desc, (o.source = 'manual') desc, o.updated_at desc;

-- ── 3) ช่องที่ใบผู้รอดเป็น 'na' (ไม่ได้ตรวจ) แต่ใบอื่นมีผลตรวจจริง → เอาผลจริงมาแทน ──
update public.bbs_observations t
set mark = b.mark, agreement_seq = b.agreement_seq, note = b.note,
    source = b.source, updated_by_name = b.updated_by_name, updated_at = now()
from (
  select distinct on (m.survivor_id, o.employee_id, o.day)
         m.survivor_id, o.employee_id, o.day, o.mark, o.agreement_seq, o.note, o.source, o.updated_by_name
  from public.bbs_observations o
  join public.bbs_sheets s on s.id = o.sheet_id
  join archive.bbs_merge_map_20261002 m on m.month_key = s.month_key and m.line_name = s.line_name
  where o.sheet_id <> m.survivor_id and o.mark <> 'na'
  order by m.survivor_id, o.employee_id, o.day, (o.source = 'manual') desc, o.updated_at desc
) b
where t.sheet_id = b.survivor_id and t.employee_id = b.employee_id
  and t.day = b.day and t.mark = 'na';

-- ── 4) หมายเหตุท้ายแถว (ตอนนี้ 0 แถว — เขียนไว้ให้ครบ) ──────────────────────
insert into public.bbs_row_notes (sheet_id, employee_id, note)
select distinct on (m.survivor_id, n.employee_id) m.survivor_id, n.employee_id, n.note
from public.bbs_row_notes n
join public.bbs_sheets s on s.id = n.sheet_id
join archive.bbs_merge_map_20261002 m on m.month_key = s.month_key and m.line_name = s.line_name
where n.sheet_id <> m.survivor_id and btrim(coalesce(n.note, '')) <> ''
  and not exists (
    select 1 from public.bbs_row_notes t
    where t.sheet_id = m.survivor_id and t.employee_id = n.employee_id)
order by m.survivor_id, n.employee_id, n.note;

-- ── 5) ลบใบที่ไม่ใช่ผู้รอด (FK cascade เก็บกวาดแถวที่ย้ายไปแล้วให้เอง) ───────
delete from public.bbs_sheets s
using archive.bbs_merge_map_20261002 m
where m.month_key = s.month_key and m.line_name = s.line_name and s.id <> m.survivor_id;

-- ── 6) ใบที่เหลือ = ไม่แยกกะ ────────────────────────────────────────────────
update public.bbs_sheets set shift = '' where shift <> '';

-- ── 7) คีย์ใหม่: 1 ใบ ต่อ (เดือน, ไลน์) ─────────────────────────────────────
drop index if exists public.bbs_sheet_uniq;
create unique index if not exists bbs_sheet_month_line_uniq
  on public.bbs_sheets (month_key, line_name);

commit;
