-- 20260918_fix_dup862_over_esmart_grbna.sql  ·  project: DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- ปัญหา (พบ 2026-09-18 · user รายงาน "ของ aat ก็ไปขึ้นย้อนหลัง ทั้งที่ e-smart ส่งไปแล้ว")
--   หลังแก้บั๊ก findEdiSheet (อ่านชีตเดียว → อ่านครบทุกชีต) ไฟล์ 862 ของ AAT (GRBNA) ถูกอ่านได้เป็น
--   ครั้งแรก แล้ว "ย้อนหลัง" ไปสร้างใบของวันที่ 18/09 ซ้ำกับเที่ยวที่ e-SMART ปิดไปแล้ว
--   ⇒ demand นับซ้ำ + สต็อก FG ถูกหักซ้ำ (ใบ 862 ที่ถูกสร้างขึ้นมาแล้ว auto-ship ตามเวลาที่เลยไปแล้ว)
--
--   ตัวกันไม่ให้เกิดซ้ำ = `src/utils/ediMerge.js` (splitAlreadyDone / findDoneCover) commit 2f617396
--   migration นี้คือการ "ล้างของที่หลุดเข้าไปก่อนตัวกันถูก deploy" เท่านั้น ไม่ได้เปลี่ยน schema
--
-- ขอบเขตที่ล้าง (แคบที่สุดเท่าที่พิสูจน์ได้ว่าซ้ำจริง):
--   customer = 'GRBNA' · due_date = '2026-09-18' · source = 'edi_862' · status = 'shipped' · dock = 'B5'
--   และมีใบ e-SMART ของ (customer, due_date, mat_no) เดียวกันที่ shipped อยู่แล้ว
--   ผลรันจริง: 9 ใบ · line_stock_transactions 9 แถว / 515 ชิ้น
--   หลังรัน: ใบ 862 shipped ของ 18/09 (B5) = 0 · e-SMART ยังครบ 9 ใบ/345 ชิ้น
--             FG stock 10100385=13374 · 10100401=13782 · 10105769=7232
--
-- ⚠️ ไม่แตะแถวอื่น: ใบ 862 ที่ยัง pending (89 ใบ 14-18/09) และแถว ship_time is null (1,480 ใบ)
--    ยังอยู่ครบ — เป็นคนละเรื่องที่รอ user เคาะ

create table if not exists _bak_20260918_dup862_orders (like customer_shipping_orders including all);
create table if not exists _bak_20260918_dup862_txns   (like line_stock_transactions including all);

with dup as (
  select o.id
    from customer_shipping_orders o
   where o.customer  = 'GRBNA'
     and o.due_date  = '2026-09-18'
     and o.source    = 'edi_862'
     and o.status    = 'shipped'
     and o.dock_code = 'B5'
     and exists (
           select 1 from customer_shipping_orders e
            where e.customer = o.customer
              and e.due_date = o.due_date
              and e.source   = 'esmart'
              and e.status   = 'shipped'
              and e.mat_no   = o.mat_no)
)
insert into _bak_20260918_dup862_orders
select o.* from customer_shipping_orders o join dup on dup.id = o.id;

insert into _bak_20260918_dup862_txns
select t.* from line_stock_transactions t
 where t.ref_shipment_id in (select id from _bak_20260918_dup862_orders);

delete from line_stock_transactions
 where ref_shipment_id in (select id from _bak_20260918_dup862_orders);

delete from customer_shipping_orders
 where id in (select id from _bak_20260918_dup862_orders);

-- ─── ROLLBACK (คืนของกลับทั้งหมด · รันบน DR "Product DB") ────────────────────────
-- insert into customer_shipping_orders select * from _bak_20260918_dup862_orders
--   on conflict (id) do nothing;
-- insert into line_stock_transactions  select * from _bak_20260918_dup862_txns
--   on conflict (id) do nothing;
-- ตารางสำรอง 2 ตัวเก็บไว้ก่อน — ลบได้เมื่อยืนยันว่ายอด FG/ยอดส่งของ 18/09 ถูกต้องแล้ว:
--   drop table _bak_20260918_dup862_orders;  drop table _bak_20260918_dup862_txns;
