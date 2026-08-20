-- ผูกรายการถังเหลือง/ถังแดง กลับไปที่ "บันทึกงานเสีย" ใน Daily Report
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive ล้วน
--
-- ที่มา: feedback หัวหน้ากลุ่ม Assy2 2026-08-19
--   "ถ้าเป็นงานเสียขอผูกกับเอกสารตัวนี้ครับ รวมถึงงานต้องสงสัยด้วยครับ"
--   → ของเสียถูกลงที่ defect_logs อยู่แล้ว (qty_ng = เสีย · qty_suspect = ต้องสงสัย)
--     แต่เดิมต้องไปคีย์ใหม่ทั้งใบที่แท็บถังเหลือง/แดง = ข้อมูลชุดเดียวกันพิมพ์ 2 รอบ
--
-- ⚠️ ทิศทางของ FK: bin → defect (ไม่ใช่ defect → bin)
--    เพราะ 1 บันทึกงานเสีย แตกได้ 2 ใบ (ต้องสงสัยลงถังเหลือง + เสียลงถังแดง)
--    เก็บฝั่ง bin จึงรองรับ 1-ต่อ-หลาย ได้โดยไม่ต้องมีตารางกลาง
--
-- ⚠️ on delete set null (ไม่ cascade) — ใบถังเป็นบันทึกคุณภาพ ต้องอยู่ต่อแม้บันทึก
--    งานเสียต้นทางถูกลบ/แก้ (หลักเดียวกับ from_yellow_id)

alter table public.quality_bin_records
  add column if not exists defect_log_id uuid
    references public.defect_logs(id) on delete set null;

create index if not exists qbin_defect_idx on public.quality_bin_records (defect_log_id)
  where defect_log_id is not null;

-- Rollback:
--   alter table public.quality_bin_records drop column defect_log_id;
