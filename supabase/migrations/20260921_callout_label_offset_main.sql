-- ตำแหน่งป้ายเลข balloon ที่คนลากเอง (MAIN · ewhdfqwfwofivojtsizn) — 2026-09-21
-- feedback หน้างาน: "อยากปรับทิศทางลูกศร ให้ลากปรับได้ เพื่อไม่ให้ทับกัน"
-- จุดที่อยู่ใกล้กันได้ทิศอัตโนมัติเหมือนกันหมด (ขวา-บน) ⇒ ป้าย/ลูกศรซ้อนกันจนอ่านไม่ออก
--
-- เก็บเป็น **% ของกล่องรูป** ไม่ใช่ px ⇒ ย่อ/ขยาย/ซูมแล้วป้ายอยู่ทิศเดิมสัดส่วนเดิม
-- (กฎเดียวกับ pos_x/pos_y ของจุด) · null ทั้งคู่ = ใช้ทิศอัตโนมัติแบบเดิมเป๊ะ
-- ⇒ **แถวเก่าทุกแถวหน้าตาไม่เปลี่ยน** (backward-compatible เต็มรูปแบบ ไม่ต้อง backfill)
alter table public.qa_inspection_items add column if not exists label_dx numeric;
alter table public.qa_inspection_items add column if not exists label_dy numeric;

comment on column public.qa_inspection_items.label_dx is
  'ตำแหน่งป้ายเลข balloon เทียบกับจุดจริง — % ของกล่องรูป (null = ใช้ทิศอัตโนมัติ) · src/utils/calloutGeom.js';
comment on column public.qa_inspection_items.label_dy is
  'คู่กับ label_dx — ต้องมีครบทั้งคู่ถึงจะถือว่าตั้งเอง (ขาดตัวใดตัวหนึ่ง = อัตโนมัติ)';

-- ตรวจ: select count(*) from information_schema.columns
--        where table_name='qa_inspection_items' and column_name in ('label_dx','label_dy');  -- 2
-- ROLLBACK: alter table public.qa_inspection_items
--             drop column if exists label_dx, drop column if exists label_dy;
