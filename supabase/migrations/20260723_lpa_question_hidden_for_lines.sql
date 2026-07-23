-- LPA: ซ่อนข้อ common (line_name null) เฉพาะบางไลน์ได้ (2026-07-23)
-- ก่อนหน้านี้ข้อ common โผล่ทุกไลน์เสมอ ตัดรายไลน์ไม่ได้ · เพิ่มคอลัมน์ hidden_for_lines[]
--   = รายชื่อไลน์ที่ "ไม่ใช้" ข้อ common นี้ (questionsFor/questionsForMonth กรองออก)
-- ตั้งจากหน้า /lpa แท็บ ⚙️ คำถาม → เลือกไลน์ → ปุ่ม 🚫 ซ่อนไลน์นี้
-- additive + nullable → backward-compatible (null/ว่าง = ใช้ทุกไลน์เหมือนเดิม)
-- โมเดล: common (null) = ฐาน backfall · แต่ละไลน์ = common − ข้อที่ซ่อน + ข้อเฉพาะไลน์ (line_name=ไลน์)

alter table public.lpa_questions
  add column if not exists hidden_for_lines text[];

comment on column public.lpa_questions.hidden_for_lines is
  'ไลน์ที่ไม่ใช้ข้อ common นี้ (เฉพาะแถว line_name null) — ตั้งจาก /lpa ⚙️ รายไลน์';
