-- ให้ SV เขียน "remark ตอนปฏิเสธปิดกะ" บอกหัวหน้ากลุ่มว่าต้องกลับไปแก้อะไร (2026-07-23)
-- DR project (production_sessions) — additive, backward-compatible (null default)
alter table public.production_sessions
  add column if not exists close_reject_reason  text,
  add column if not exists close_reject_by_name text,
  add column if not exists close_reject_at       timestamptz;

comment on column public.production_sessions.close_reject_reason is
  'เหตุผล/สิ่งที่ต้องแก้ไข ที่ SV ระบุตอนปฏิเสธคำขอปิดกะ — โชว์ให้หัวหน้ากลุ่มเห็นตอนกะกลับเป็น open · เคลียร์เมื่อส่งขอปิดกะใหม่/ปิดกะสำเร็จ';
