-- 20260921_move_862_longrange_out_of_shipping_orders.sql · DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- คำสั่ง user 2026-09-20 ("เอาเลย") — ต่อจากการเคลียร์ใบค้างอดีต 19/09
--   ปัญหา: แถว **แผนระยะยาว** จากไฟล์ 862 (ชีตที่ช่อง `Forecast Time` ว่าง — GBJWA/GBJWE/GBJWC)
--   ถูกนำเข้าเป็น `customer_shipping_orders` ⇒ ไม่มีวันมีใครกดส่ง ⇒ **ทยอยเลยกำหนดกลายเป็น
--   สีแดงวันต่อวัน** บนบอร์ด Delivery (ล้างอดีตวันนี้ พรุ่งนี้ก็แดงใหม่)
--
-- เกณฑ์ตรงกับ `splitFirmVsForecast()` ใน `src/utils/ediMerge.js` เป๊ะ (คู่กัน ห้ามแก้ข้างเดียว):
--   **ไม่มี ship_time  +  due_date > วันนี้ + 14 วัน  =  แผน ไม่ใช่ใบส่งของ**
--   · แถว *มีเวลา* = เที่ยวที่ยืนยันแล้ว ไกลแค่ไหนก็เป็นใบส่งของ → ไม่แตะ
--   · แถว *ไม่มีเวลาแต่อยู่ใน 14 วัน* = ของใกล้ส่ง หน้างานต้องเห็น → ไม่แตะ
--   · กันพลาดอีกชั้น: ข้ามใบที่มี `line_stock_transactions` (ของออกจากคลังแล้ว) เสมอ
--
-- พิสูจน์ก่อนลบว่าไม่ได้ทำข้อมูลหาย: ทั้ง 1,361 แถวนี้ **ซ้ำกับ `customer_forecasts`
-- ของ EDI 830 ครบ 100%** (mat × เดือนเดียวกัน · 830 เป็นเจ้าของแผนระยะยาวอยู่แล้ว)
--   GBJWC 652 · GRBNA 210 · GBL9A 207 · GBJWE 164 · GBJWA 86 · HPUDA 42
--
-- ผลรันจริง 21/09: ลบ **1,361 ใบ / 2,005,714 ชิ้น**
--   หลังรัน — แถวแผนระยะยาวที่ยังค้างเป็นใบส่งของ = 0 · ใบค้างในอดีต = 0 ·
--   ใบเปิดทั้งหมดเหลือ 292 (ของจริงทั้งหมด) · orphan txn = 0 · forecast 830 ครบ 1,599 แถว
--
-- 🔒 ไม่แตะ `line_stock_transactions` และไม่แตะ `customer_forecasts` เลย

create table if not exists _bak_20260921_862_longrange (like customer_shipping_orders including all);

create temp table _del_fc as
select c.id from customer_shipping_orders c
 where c.status <> 'shipped'
   and (c.ship_time is null or c.ship_time = '')
   and c.due_date > current_date + 14
   and not exists (select 1 from line_stock_transactions t where t.ref_shipment_id = c.id);

insert into _bak_20260921_862_longrange
select c.* from customer_shipping_orders c join _del_fc d on d.id = c.id;

delete from customer_shipping_orders where id in (select id from _del_fc);

-- ── ROLLBACK (รันบน DR "Product DB" eyhclzkifitbhbljgoav) ────────────────
--   insert into customer_shipping_orders
--   select * from _bak_20260921_862_longrange b
--    where not exists (select 1 from customer_shipping_orders c where c.id = b.id);
-- ตารางสำรองลบได้เมื่อผ่าน go-live แล้วยืนยันว่าไม่ต้องย้อน:
--   drop table _bak_20260921_862_longrange;
