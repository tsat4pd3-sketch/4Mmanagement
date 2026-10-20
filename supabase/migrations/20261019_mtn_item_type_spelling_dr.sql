-- DR project (eyhclzkifitbhbljgoav · "Product DB") — 2026-10-19 · คำสั่ง user "แก้สะกดให้ถูกด้วย"
-- "Robot Handing [ ... ]" → "Robot Handling [ ... ]" (ทะเบียนชนิดอุปกรณ์ของทีม MTN)
-- 🔴 mtn_orders.item_type เก็บ "ชื่อ" เป็น text (ไม่ผูก FK) ⇒ เปลี่ยนชื่อทะเบียนต้องไล่แก้ใบ MO ในคราวเดียว
--    (กฎทะเบียนที่จับคู่ด้วยข้อความ · CLAUDE.md §Database Schema)
--    die_set_kinds / die_op_types.mo_item_type ไม่มีค่าที่สะกดผิด (เช็ค 19/10) · snapshot ใบที่พิมพ์ไปแล้ว = บันทึก ไม่แตะ
-- ย้อนกลับ: สลับ 2 คำใน update ทั้งสองชุด
begin;
set local lock_timeout = '5s';
update public.mtn_orders
   set item_type = replace(item_type, 'Robot Handing', 'Robot Handling')
 where item_type like 'Robot Handing [%';
update public.mtn_item_types
   set name = replace(name, 'Robot Handing', 'Robot Handling')
 where name like 'Robot Handing [%';
commit;
-- เช็คผล: select name from mtn_item_types where name ilike '%handing%' or name ilike 'robot handling [%';
