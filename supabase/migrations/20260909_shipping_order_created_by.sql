-- ══ 📜 ประวัติ order เข้าระบบ — เก็บ "ใครคีย์ใบนี้" ═══════════════════════════════════
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ที่มา (user 2026-09-09): *"สิ่งที่อัพโหลดไป ให้มี log และ tab เข้าไปดูด้วยสิ รวมถึงงาน add order"*
--
-- ปัญหา: แท็บ 📜 ประวัติ ตอบได้ว่าไฟล์ไหนใครอัพ (`customer_pull_batches.uploaded_by` /
-- `demand_upload_batches.uploaded_by`) แต่ **ใบที่คีย์มือ (`source='manual'`) ไม่มีร่องรอยคนทำเลย**
-- — ตารางนี้ track แค่ `created_at` ⇒ log จะมีช่องโหว่อยู่ทางเดียวจาก 3 ทาง
--
-- ⚠️ additive · nullable — ใบเก่าคง null (จอเขียน "ไม่ระบุผู้ทำ" **ห้ามเดาชื่อย้อนหลัง**)
-- ⚠️ ไม่ backfill โดยตั้งใจ: ไม่มีข้อมูลไหนบอกได้ว่าใครคีย์ใบเก่า เดาแล้วผิด = log ที่เชื่อไม่ได้
--    ซึ่งแย่กว่าช่องว่างที่ยอมรับว่าไม่รู้

alter table public.customer_shipping_orders add column if not exists created_by_name text;
comment on column public.customer_shipping_orders.created_by_name is
  'ชื่อผู้สร้างใบ (snapshot จาก profiles.full_name ตอนกด) — คีย์มือ = คนกด ➕ · e-SMART = คนอัพไฟล์ · EDI = null (ดูที่ batch) · null ในใบเก่า = ไม่รู้ ห้ามเดา';

/* ══ ROLLBACK ═════════════════════════════════════════════════════════════════════
alter table public.customer_shipping_orders drop column if exists created_by_name;
   ⚠️ revert โค้ดก่อน (แท็บ 📜 จะ retry แบบไม่มีคอลัมน์อยู่แล้ว จึงไม่พังระหว่างทาง)
══════════════════════════════════════════════════════════════════════════════════ */
