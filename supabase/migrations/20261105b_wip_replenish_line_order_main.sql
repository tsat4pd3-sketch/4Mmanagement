-- 2026-11-05 · Main ("MAIN" · ewhdfqwfwofivojtsizn)
-- ไลน์เปิดใบผลิต ⇒ ระบบแตก BOM เทียบ WIP หน้าไลน์ ขาดครบ packing std ⇒ ออกใบเบิกให้สโตร์เอง (คำสั่ง user 05/11)
-- 1) source ใหม่ 'line_order' = ใบที่ระบบออกจากใบผลิตที่เปิดอยู่
-- 2) 1 พาร์ท/ไลน์ มีใบ "ยังไม่หยิบ" ได้ใบเดียว (suggested/hold/pending) — เดิมนับ preparing/delivered ด้วย
--    ⇒ ใบที่สโตร์กำลังเตรียม/ส่งแล้วค้างไม่กดรับ บล็อกความต้องการรอบใหม่ทั้งที่ยอดย้ายเข้าไลน์ไปแล้ว
-- ย้อน: drop index wip_replenish_open_per_part_uniq; create unique index … (status in suggested,hold,pending,preparing,delivered)
--       + alter check กลับเป็น 3 ค่าเดิม (ต้องไม่มีแถว source='line_order' ก่อน)
alter table public.wip_replenish_requests drop constraint if exists wip_replenish_source_chk;
alter table public.wip_replenish_requests add constraint wip_replenish_source_chk
  check (source = any (array['line'::text, 'line_adhoc'::text, 'store_forecast'::text, 'line_order'::text]));
drop index if exists public.wip_replenish_open_per_part_uniq;
create unique index wip_replenish_open_per_part_uniq on public.wip_replenish_requests (line_name, mat_no)
  where wip_point_id is null and status = any (array['suggested'::text, 'hold'::text, 'pending'::text]);
