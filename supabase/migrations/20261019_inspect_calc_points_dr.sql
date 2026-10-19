-- 🧮 จุดตรวจแบบ "คำนวณ" (PM · DR project "Product DB" eyhclzkifitbhbljgoav) — 2026-10-19
-- ค่า = จุด A − จุด B คิดให้เองตอนตรวจ · null = จุดวัดปกติ (แถวเดิมทั้งหมด = พฤติกรรมเดิม)
-- รูปแบบ: {"op":"diff","a":"<jig_checkpoints.id>","b":"<jig_checkpoints.id>","abs":false}
-- กฎอยู่ src/utils/inspectCalc.js · 📄 docs/modules/inspection-point-setup.md §จุดคำนวณ
-- RLS เดิมของตารางครอบคอลัมน์ใหม่ (ไม่แตะ policy)
alter table public.jig_checkpoints add column if not exists calc jsonb;
comment on column public.jig_checkpoints.calc is
  'จุดคำนวณ {op:diff,a,b,abs} — ค่า = A − B คิดตอนตรวจ (src/utils/inspectCalc.js) · null = จุดวัดปกติ';
-- ย้อนกลับ: alter table public.jig_checkpoints drop column if exists calc;  (revert โค้ดก่อน)
