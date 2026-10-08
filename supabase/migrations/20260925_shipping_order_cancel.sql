-- 20260925_shipping_order_cancel.sql · project: DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- สถานะ "ยกเลิก" ของใบส่งของ — ทางออกข้างทางแทนการลบข้อมูลทิ้ง
--
-- ที่มา: ช่วง trial เราเคลียร์ใบที่ไม่ได้ส่งด้วยการ **ลบ + สำรอง** (19/09 ล้าง 553 ใบ ·
--   21/09 ล้าง 1,361 ใบ) ซึ่งทำได้เพราะเป็นข้อมูลทดลอง · **หลัง go-live ห้ามลบข้อมูลจริง**
--   ต้องมีสถานะปิดที่สืบกลับได้ว่า ใครยกเลิก เมื่อไหร่ เพราะอะไร
--
-- เหตุผลที่ก่อนหน้านี้ไม่กล้าเพิ่ม: ทั้งระบบนิยาม "งานค้าง" ด้วย `neq('status','shipped')`
--   กระจาย 7 จุด ⇒ ตกจุดเดียว ใบที่ยกเลิกยังโผล่แดงเงียบๆ
--   แก้พร้อมกันในคอมมิทนี้: `src/utils/shipStatus.js` เป็นเจ้าของนิยามจุดเดียว (`openOnly`)
--   + ด่าน `regressionGuards` ห้ามเขียน `neq('status','shipped')` ดิบอีก
--
-- backward-compatible ทุกข้อ:
--   · คอลัมน์ใหม่ 3 ตัว nullable — แถวเดิมไม่ต้องแก้
--   · check constraint แค่ "เพิ่มค่าที่ยอมรับ" ไม่ตัดค่าเดิม
--   · โค้ดเวอร์ชันเก่าที่ยังไม่รู้จัก 'cancelled' ยังทำงานได้ (แค่ไม่เห็นใบที่ยกเลิก)

alter table customer_shipping_orders add column if not exists cancel_reason text;
alter table customer_shipping_orders add column if not exists cancelled_at  timestamptz;
alter table customer_shipping_orders add column if not exists cancelled_by  text;

alter table customer_shipping_orders drop constraint if exists customer_shipping_orders_status_check;
alter table customer_shipping_orders add  constraint customer_shipping_orders_status_check
  check (status in ('pending','confirmed','prepared','loaded','shipped','cancelled'));

-- ยกเลิกต้องมีเหตุผลเสมอ — ใบที่ปิดโดยไม่บอกว่าทำไม สืบกลับไม่ได้ว่าลูกค้าไม่ได้ของเพราะอะไร
-- บังคับที่ DB ด้วย ไม่ใช่แค่ฝั่งจอ (กันการเขียนตรงผ่าน API/สคริปต์)
alter table customer_shipping_orders drop constraint if exists cso_cancel_needs_reason;
alter table customer_shipping_orders add  constraint cso_cancel_needs_reason
  check (status <> 'cancelled' or coalesce(btrim(cancel_reason), '') <> '');

comment on column customer_shipping_orders.cancel_reason is
  'เหตุผลที่ยกเลิกใบ (บังคับเมื่อ status = cancelled) — ดู src/utils/shipStatus.js';

-- ⚠️ กติกาเชิงธุรกิจที่บังคับฝั่งจอ (ไม่ได้บังคับที่ DB เพราะจุดหักสต็อกตั้งค่าได้ต่อลูกค้า):
--    **ยกเลิกได้เฉพาะใบที่ยังไม่ถึงขั้นหักสต็อก** — ใบที่ของออกจากคลังไปแล้วต้องคืนของก่อน
--    ไม่งั้นยอดคงเหลือเพี้ยนเงียบ (ดู cancelOrder() ใน src/pages/CustomerDemand.jsx)

-- ── ROLLBACK (รันบน DR "Product DB" eyhclzkifitbhbljgoav) ────────────────
--   update customer_shipping_orders set status='pending' where status='cancelled';
--   alter table customer_shipping_orders drop constraint if exists cso_cancel_needs_reason;
--   alter table customer_shipping_orders drop constraint if exists customer_shipping_orders_status_check;
--   alter table customer_shipping_orders add constraint customer_shipping_orders_status_check
--     check (status in ('pending','confirmed','prepared','loaded','shipped'));
--   (คอลัมน์ 3 ตัวปล่อยไว้ได้ — nullable ไม่กระทบใคร)
