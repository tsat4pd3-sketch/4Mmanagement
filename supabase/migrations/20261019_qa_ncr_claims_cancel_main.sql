-- ❌ ยกเลิกใบ NCR / เคลมลูกค้าที่ "เปิดผิด" (MAIN "MAIN" ewhdfqwfwofivojtsizn) — 2026-10-19 · หน้างานแจ้ง
-- เดิมเปิดแล้วไม่มีทางถอย (ไม่มีลบ/ยกเลิก) ⇒ ใบซ้ำ/ใบผิดค้างนับเป็นงานค้างตลอดไป
-- หลัก: เอกสารที่มีเลขที่แล้ว **ห้ามลบ** (เลขจะขาดช่วง/สอบย้อนไม่ได้) ⇒ ทำเป็นสถานะ `cancelled` + เหตุผล + ใครยกเลิก
-- ตัวตัดสิน "ยังค้างไหม" = src/utils/qaDocStatus.js (isOpenQaDoc) · แถวเดิมไม่เปลี่ยน
alter table public.qa_ncr drop constraint if exists qa_ncr_status_check;
alter table public.qa_ncr add constraint qa_ncr_status_check
  check (status = any (array['open','containment','disposition','closed','cancelled']));
alter table public.qa_customer_claims drop constraint if exists qa_customer_claims_status_check;
alter table public.qa_customer_claims add constraint qa_customer_claims_status_check
  check (status = any (array['open','investigating','replied','closed','cancelled']));

alter table public.qa_ncr add column if not exists cancel_reason text;
alter table public.qa_ncr add column if not exists cancelled_by text;
alter table public.qa_ncr add column if not exists cancelled_at timestamptz;
alter table public.qa_customer_claims add column if not exists cancel_reason text;
alter table public.qa_customer_claims add column if not exists cancelled_by text;
alter table public.qa_customer_claims add column if not exists cancelled_at timestamptz;
-- ยกเลิกต้องมีเหตุผลเสมอ (ห้ามหายเงียบ)
alter table public.qa_ncr drop constraint if exists qa_ncr_cancel_reason_chk;
alter table public.qa_ncr add constraint qa_ncr_cancel_reason_chk
  check (status <> 'cancelled' or coalesce(btrim(cancel_reason), '') <> '');
alter table public.qa_customer_claims drop constraint if exists qa_claims_cancel_reason_chk;
alter table public.qa_customer_claims add constraint qa_claims_cancel_reason_chk
  check (status <> 'cancelled' or coalesce(btrim(cancel_reason), '') <> '');
-- RLS เดิมครอบ (UPDATE: qa:record ทั้ง 2 ตาราง)
-- ย้อนกลับ (revert โค้ดก่อน · ต้องไม่มีแถว cancelled ค้าง):
--   update ... set status='open' where status='cancelled';  แล้ว drop constraint *_cancel_reason_chk + คืน status_check เดิม
