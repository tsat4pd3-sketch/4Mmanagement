-- ถังเหลือง: ผลการพิจารณาของ QA ให้ครบ 4 ทางตาม WI-PD3-069 §5.4 (เดิมระบบมีแค่ 2)
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive ล้วน (คอลัมน์ใหม่ nullable, แถวเดิมไม่ถูกแตะ)
--
-- ที่มา: อ่าน WI จริงแล้วพบว่าระบบขาด 2 ทาง (2026-09-25)
--   WI §5.4 หัวหน้า PD ออก FM-PD1-019 แล้ว QA พิจารณา **3 ทาง**: ซ่อม | ทำลาย | ขอใช้ (FM-QA-042)
--   และ §5.4 ยังมีกรณี "งานดี" (ตรวจแล้วใช้ได้) → ติดแท็กเขียว FM-QA-098 กลับเข้ากระบวนการ
--   ระบบเดิมรองรับแค่ ซ่อม (repair_*/qty_ok/qty_ng) กับ ทำลาย (ปุ่ม ➡️ ลงถังแดง)
--   ⇒ ของที่ "ตรวจแล้วดี" กับ "ขออนุมัติใช้เป็นกรณีพิเศษ" ไม่มีที่ลง = ค้างในถังตลอดกาลบนจอ
--
-- ⚠️ null = "QA ยังไม่พิจารณา" ไม่ใช่ "ไม่มีผล" — แถวเดิม 25 แถวเป็น null ทั้งหมด
--    จอต้องแสดงว่า "รอ QA พิจารณา" ห้ามเดาผลให้ และห้ามบล็อกการแก้ใบเดิม
--
-- ⚠️ ไม่เพิ่มคอลัมน์ tag_date — วันที่บนแท็ก = `work_date` (วันที่ลงถัง) ที่กรอกอยู่แล้ว
--    คอลัมน์วันที่ซ้ำที่ไม่มีจุดกรอก = "ช่องตาย" (บทเรียน extra.problem 2026-08-28)

alter table public.quality_bin_records
  add column if not exists qa_decision       text,
  add column if not exists qa_decision_at    timestamptz,
  add column if not exists special_use_doc_no text;   -- เลขใบ FM-QA-042 (ทาง "ขอใช้")

do $$ begin
  alter table public.quality_bin_records
    add constraint qbin_qa_decision_chk
    check (qa_decision is null or qa_decision in ('good','repair','use_as_is','scrap'));
exception when duplicate_object then null; end $$;

comment on column public.quality_bin_records.qa_decision is
  'ผลพิจารณา QA ตาม WI-PD3-069 §5.4: good=งานดี(แท็กเขียว) · repair=ซ่อม · use_as_is=ขอใช้(FM-QA-042) · scrap=ทำลาย · null=ยังไม่พิจารณา';

create index if not exists qbin_decision_idx on public.quality_bin_records (qa_decision)
  where qa_decision is not null;

-- Rollback:
--   alter table public.quality_bin_records
--     drop column qa_decision, drop column qa_decision_at, drop column special_use_doc_no;
