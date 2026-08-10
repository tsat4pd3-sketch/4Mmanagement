-- หมายเหตุของ "หัวหน้ากลุ่ม" (ผู้ขอปิดกะ) — คู่กับหมายเหตุฝั่ง SV ที่มีอยู่แล้ว (2026-08-10)
--   close_request_note  = คนขอปิดกะเขียน   (ใหม่)  → SV อ่านก่อนตัดสินใจ
--   close_approve_note  = SV เขียนตอนอนุมัติ (เดิม)
--   close_reject_reason = SV เขียนตอนปฏิเสธ (เดิม)
-- DR project (production_sessions) — additive, backward-compatible (null default)
-- โค้ดฝั่งแอปเขียนค่านี้แบบ best-effort (update แยก + try/catch) → ยังไม่ apply migration
-- ก็ปิดกะได้ปกติ แค่ยังไม่เก็บข้อความ
alter table public.production_sessions
  add column if not exists close_request_note text;

comment on column public.production_sessions.close_request_note is
  'หมายเหตุที่หัวหน้ากลุ่มเขียนตอนส่งขอปิดกะ (เช่น เหตุผลที่ยอดไม่ถึงเป้า) — แสดงในหน้าตรวจสอบคำขอของ SV และในประวัติกะ';
