-- เชื่อม Improvements ↔ MTN (2026-07-14) · Project: DR
-- อนุญาต problem_source = 'mtn' → โปรเจค Kaizen วัดผลก่อน/หลังจากใบซ่อม MO (จำนวนใบ + นาที breakdown)
alter table public.improvements drop constraint if exists improvements_problem_source_check;
alter table public.improvements add constraint improvements_problem_source_check
  check (problem_source = any (array['downtime'::text, 'defect'::text, 'mtn'::text]));
