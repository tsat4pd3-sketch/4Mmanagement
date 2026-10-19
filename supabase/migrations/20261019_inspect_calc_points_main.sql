-- 🧮 จุดตรวจแบบ "คำนวณ" (QA · Main project "MAIN" ewhdfqwfwofivojtsizn) — 2026-10-19
-- ค่า = จุด A − จุด B คิดให้เองตอนตรวจ · null = จุดวัดปกติ (แถวเดิมทั้งหมด = พฤติกรรมเดิม)
-- รูปแบบ: {"op":"diff","a":"<qa_inspection_items.id>","b":"<qa_inspection_items.id>","abs":false}
-- กฎอยู่ src/utils/inspectCalc.js · 📄 docs/modules/inspection-point-setup.md §จุดคำนวณ
-- RLS เดิมของตาราง (has_perm('qa:manage')) ครอบคอลัมน์ใหม่
alter table public.qa_inspection_items add column if not exists calc jsonb;
comment on column public.qa_inspection_items.calc is
  'จุดคำนวณ {op:diff,a,b,abs} — ค่า = A − B คิดตอนตรวจ (src/utils/inspectCalc.js) · null = จุดวัดปกติ';
-- ย้อนกลับ: alter table public.qa_inspection_items drop column if exists calc;  (revert โค้ดก่อน)
