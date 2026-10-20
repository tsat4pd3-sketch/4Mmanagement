-- ─────────────────────────────────────────────────────────────────────────────
-- 📐 Machine Break Down = "%" ตามมาตรฐาน — คืนหน่วยที่ถูกแก้เป็น "Hrs." วันนี้     (Main project · ewhdfqwfwofivojtsizn)
-- 2026-10-13 · user ถาม "หน่วยเป็นอะไรกันแน่ hrs. / % — ข้อกำหนดเป็น %" (บอร์ด OBEYA แผนก MTN)
--
-- ── ที่มา (audit_log) ───────────────────────────────────────────────────────
--   14:16–14:45 น. ผู้ใช้ทีม MTN แก้ที่แท็บ ⚙️:
--     · kpi_catalog "Machine Break Down"  unit  %  →  Hrs.          (ทะเบียนกลาง — กระทบทุกหน่วยที่อ้างทะเบียน)
--     · kpi_definitions MTN               unit Hrs. · target "≤ 0.00 Hrs." · commitment "≤ 5.00 Hrs"
--                                         formula_text ถูกตัดเหลือตัวตั้ง "No. of hours the machine has been stopped"
--     · kpi_manual_entries MTN ม.ค.–ต.ค. คีย์เป็น **ชั่วโมง** (2 · 6 · 15 · 1 · 5.5 · 114.5 · 30 · 2 · 0 · 0)
--       ทับค่าเดิม 2/10 ที่เป็น % จากระบบ (มิ.ย. 0.0092 · ก.ค. 0.0912 · ส.ค. 0.2046 · ก.ย. 0.217 · ต.ค. 0.026)
--   ⇒ บอร์ดเดือนเดียวกันเอา "ชั่วโมง" (ม.ค.–พ.ค. กรอกมือ) มาวางข้าง "%" (มิ.ย.–ต.ค. ระบบคำนวณ) แล้วติดป้าย Hrs. ทั้งแผ่น
--
-- ── มาตรฐาน ────────────────────────────────────────────────────────────────
--   KPI Guideline 2026 หน้า 10 (kpi_standard_items seq 5 · Maintenance):
--     Machine Break Down = (No. of hours the machine has been stopped / No. of hours the machine can work normally) × 100  ⇒ **%**
--   เป้าทางการของแผนก MTN (KPI Management Review H1 FY2026 · docs/OBEYA-KPI-SOURCES.md §16): Target 0% · Commitment ≤0.28%
--   ตัวหารที่ระบบใช้ = 730 ชม. × จำนวนเครื่อง active ชนิด machine (216 ตัว ณ 13/10) — src/utils/kpiAuto.js (ASSUMPTION_MBD)
--
-- ── สิ่งที่ทำ ──────────────────────────────────────────────────────────────
--   ① ทะเบียนกลาง: unit กลับเป็น % · decimals 2 → 3 (ค่าจริง 0.009–0.22% — 2 ตำแหน่งปัดเหลือ 0.01/0.00 อ่านไม่ออก)
--   ② นิยาม MTN: unit % · เป้าตามใบจริง (0% / ≤0.28%) · formula_text เต็มตามมาตรฐาน · decimals 3
--   ③ ค่ากรอกมือที่คีย์เป็นชั่วโมง → แปลงเป็น % ด้วยตัวหารเดียวกับระบบ (÷(730×216)×100) และ **เก็บชั่วโมงเดิมไว้ใน note**
--      (ไม่ทิ้งข้อมูลที่ทีมคีย์ · ย้อนได้จาก note) — เฉพาะแถวที่ updated_at วันนี้และยังไม่มี note การแปลง (idempotent)
--   ⚠️ ชั่วโมงที่ทีม MTN คีย์ **ไม่ตรงกับ downtime_logs** (มิ.ย. ทีม 114.5 ชม. · ระบบ 14.5 ชม. · ส.ค. ทีม 2 ชม. · ระบบ 322.7 ชม.)
--      = คนละฐานข้อมูล — เรื่องนี้ต้องให้ user/ทีม MTN เคาะ (ดู docs/modules/obeya-kpi-board.md §MBD หน่วย)
--
-- ROLLBACK:
--   update kpi_catalog set unit='Hrs.', decimals=2 where id='f7b44dbb-70eb-49a7-b68c-141f713e8b54';
--   update kpi_definitions set unit='Hrs.', decimals=null, target='≤ 0.00  Hrs.', commitment='≤ 5.00 Hrs', target_value=0, commit_value=null,
--          target_compare=null, commit_compare=null, formula_text='No. of hours the machine has been stopped ' where id='930dae09-6f55-42d7-b2f0-a25f303a3533';
--   update kpi_manual_entries set value = (regexp_match(note, 'แปลงจาก ([0-9.]+) ชม'))[1]::numeric, note = null
--    where kpi_id='930dae09-6f55-42d7-b2f0-a25f303a3533' and note like 'แปลงจาก % ชม%';
-- ─────────────────────────────────────────────────────────────────────────────

-- ① ทะเบียนกลาง
update public.kpi_catalog
   set unit = '%', decimals = 3
 where id = 'f7b44dbb-70eb-49a7-b68c-141f713e8b54' and name = 'Machine Break Down';

-- ② นิยามของแผนก MTN
update public.kpi_definitions
   set unit = '%', decimals = 3,
       target = '≤0%', target_value = 0, target_compare = '<=',
       commitment = '≤0.28%', commit_value = 0.28, commit_compare = '<=',
       formula_text = '(No. of hours the machine has been stopped / No. of hours the machine can work normally) x 100'
 where id = '930dae09-6f55-42d7-b2f0-a25f303a3533' and name = 'Machine Break Down' and scope_value = 'MTN';

-- ③ ค่ากรอกมือ ชั่วโมง → % (ตัวหาร 730 × 216 เครื่อง = 157,680 ชม./เดือน) · เก็บชั่วโมงเดิมใน note
update public.kpi_manual_entries e
   set value = round((e.value / (730.0 * 216)) * 100, 5),
       note  = trim(concat_ws(' · ', nullif(e.note, ''), 'แปลงจาก ' || trim(to_char(e.value, 'FM9999990.99')) || ' ชม. ที่คีย์ 13/10 (÷(730×216 เครื่อง)×100 · ระบบแปลงให้ตรงหน่วย % ตามมาตรฐาน)'))
 where e.kpi_id = '930dae09-6f55-42d7-b2f0-a25f303a3533'
   and e.updated_at::date = '2026-10-13'
   and coalesce(e.note, '') not like '%แปลงจาก %ชม.%';

-- ตรวจผล:
--   select name, unit, decimals from kpi_catalog where id='f7b44dbb-70eb-49a7-b68c-141f713e8b54';
--   select unit, target, commitment, target_value, commit_value from kpi_definitions where id='930dae09-6f55-42d7-b2f0-a25f303a3533';
--   select month, value, note from kpi_manual_entries where kpi_id='930dae09-6f55-42d7-b2f0-a25f303a3533' order by month;
