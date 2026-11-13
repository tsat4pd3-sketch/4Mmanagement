-- ⏳ ใบ MO ที่ระบบเปิดให้ตอนกด "เรียกช่าง" แล้วยังรอคนใส่รายละเอียด  ·  2026-11-13
-- Project: DR (ชื่อในจอ Supabase = "Product DB" · eyhclzkifitbhbljgoav)
-- 🔴 nullable ไม่มี default · null/false = ใบปกติ (กรอกครบตอนเปิด) ⇒ ข้อมูลเก่าไม่ถูกแตะ
-- ย้อนกลับ: drop index if exists idx_mtn_orders_details_pending;
--           alter table public.mtn_orders drop column details_pending;
-- เจ้าของกฎฝั่งจอ: src/utils/moDetailsPending.js

alter table public.mtn_orders
  add column if not exists details_pending boolean;

comment on column public.mtn_orders.details_pending is
  'true = ใบที่ระบบเปิดให้ตอนกด "เรียกช่าง" และยังรอคนใส่รายละเอียด (ชนิดอุปกรณ์·ลักษณะปัญหา·รูปก่อนซ่อม) · null/false = ใบปกติ · ปลดธงตอนกรอกครบผ่านฟอร์มแจ้งซ่อมเท่านั้น · ไม่ใช่สถานะงาน ห้ามเอาไปบล็อกขั้น';

-- คิว "รอเพิ่มรายละเอียด" ต้องเปิดเร็ว — index เฉพาะแถวที่ติดธง
create index if not exists idx_mtn_orders_details_pending
  on public.mtn_orders (report_at desc)
  where details_pending is true;
