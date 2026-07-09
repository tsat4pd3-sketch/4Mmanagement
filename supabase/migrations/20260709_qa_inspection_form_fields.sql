-- ปรับ qa_parts / qa_inspection_items ให้ตรงฟอร์มจริง FM-QA-112 (Inspection Data Sheet)
-- Target project: MAIN (ewhdfqwfwofivojtsizn)
--
-- จากฟอร์มตัวอย่าง (SUPT ASY RAD · MB3B-8A297):
--   - เลขจุดตรวจเป็นตัวอักษรผสม เช่น A1, B, D1-D4, H1-H35, 1-20 → balloon_no ต้องเป็น text
--   - มีคอลัมน์ Rank: M / SC (control characteristic)
--   - header มี Dwg.No แยกจาก Revision, Concern No.,
--     Part Classification (Safety / Important-Regulation / General)
--     และชนิด part (Completed / Component-Child / Raw material)

alter table qa_inspection_items
  alter column balloon_no type text using balloon_no::text;

alter table qa_inspection_items
  add column if not exists rank text check (rank in ('M','SC'));

alter table qa_parts add column if not exists dwg_no     text;
alter table qa_parts add column if not exists concern_no text;
alter table qa_parts add column if not exists part_rank  text
  check (part_rank in ('safety','important','general'));
alter table qa_parts add column if not exists part_kind  text
  check (part_kind in ('completed','component','raw_material'));
