-- 20260923_role_warehouse_delivery_enum.sql  ·  ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- เพิ่ม role ใหม่ `warehouse_delivery` = ฝั่ง **Warehouse & Delivery (ส่งลูกค้า)**
-- ⚠️ ต้องแยกไฟล์จาก seed — PostgreSQL ใช้ค่า enum ที่เพิ่งเพิ่ม "ในทรานแซกชันเดียวกัน" ไม่ได้
--    (รวมไฟล์เดียวแล้วจะได้ `unsafe use of new value of enum type`)
-- ⚠️ ค่าใน enum **ลบทิ้งไม่ได้** — ตั้งชื่อแล้วติดถาวร แก้ได้เฉพาะป้ายที่แสดงบนจอ (`src/utils/roleMeta.js`)
alter type public.user_role add value if not exists 'warehouse_delivery';
