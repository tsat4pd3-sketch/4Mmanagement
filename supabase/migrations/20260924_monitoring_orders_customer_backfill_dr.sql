-- ═══════════════════════════════════════════════════════════════════════════════
-- 🏷️ เติมชื่อลูกค้าให้ใบที่นำเข้าจากไฟล์ Monitoring (DR project)
--    Supabase: "Product DB" · eyhclzkifitbhbljgoav
--    2026-09-24 · recheck จาก feedback แพลนนิ่ง "ลูกค้า TSESA ไม่ขึ้นค่ะ"
--
-- ต้นเหตุ: ตัวนำเข้า (MonitoringUpload) **ไม่เคยเขียนคอลัมน์ `customer` เลย**
--   ⇒ ใบทั้ง 232 ใบมี customer = null ⇒ จอ 🚚 Delivery ซึ่งจัดกลุ่มตามลูกค้า
--     เอาไปกองรวมใน "— ไม่ระบุลูกค้า —" ⇒ หน้างานอ่านว่า "ลูกค้านี้ไม่ขึ้น"
--   แก้ที่โค้ดแล้ว (utils/monitoringSheet.js → sheetCustomer + customers registry)
--   ไฟล์นี้ = ไล่เติมย้อนหลังให้ใบที่นำเข้าไปก่อนหน้า
--
-- ที่มาของชื่อ = ชื่อชีทในหมายเหตุ ("Monitoring · TSPK") เทียบทะเบียน `customers`
--   กติกาเดียวกับ sheetCustomer(): trim + ตัดส่วนหลัง '+' ("TSESA+LA" → "TSESA")
--   🔴 ไม่มีในทะเบียน = ปล่อย null ห้ามยัดชื่อชีทดิบเป็นลูกค้า
--
-- Rollback: update customer_shipping_orders set customer = null
--             where source = 'monitoring';
-- ═══════════════════════════════════════════════════════════════════════════════

update customer_shipping_orders o set customer = c.name
from customers c
where o.source = 'monitoring' and o.customer is null
  and upper(c.code) = upper(split_part(split_part(o.note, ' · ', 2), '+', 1))
  and c.is_active;

-- ตรวจผล: ต้องไม่เหลือใบ monitoring ที่ customer ว่าง (ยกเว้นชีทที่ไม่มีในทะเบียน)
-- select coalesce(customer,'(ยังว่าง)'), count(*) from customer_shipping_orders
--  where source='monitoring' group by 1;
