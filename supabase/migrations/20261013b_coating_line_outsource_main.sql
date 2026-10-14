-- 🧪 ไลน์ "Coating" (user สร้าง 13/10 ไว้วางสินค้าหลังชุบ) = ประเภทไลน์ "จ้างนอก"
-- Project: MAIN ("MAIN" · ewhdfqwfwofivojtsizn) · apply แล้ว 13/10
-- สินค้าบนไลน์ประเภทนี้ = สินค้าหลังชุบในแท็บ 🧪 งานชุบ (src/utils/plating.js · platingProducts)
-- ประเภทไลน์แก้เองได้ที่ /line-setup (ไม่มีชื่อไลน์ในโค้ด)
-- ย้อน: update production_lines set line_type = null where id = 58 and line_type = 'outsource';
update public.production_lines set line_type = 'outsource'
 where id = 58 and name = 'Coating' and line_type is null;
-- ตรวจ: select id, name, line_type from production_lines where line_type = 'outsource';
