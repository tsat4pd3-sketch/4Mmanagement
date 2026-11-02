-- ── DR project — ชื่อในจอ Supabase "Product DB" (eyhclzkifitbhbljgoav) ──
-- 🔴 อะไหล่ไม่ถูกบันทึกลงใบ MO เลยตั้งแต่ 22/10 — แต่สต็อกยังถูกตัดจริง (ทีม MTN แจ้ง 01/11)
--
-- ต้นเหตุ: `mtn_order_parts` มี RLS policy `for all to anon,authenticated using(true)`
--          แต่ **GRANT ระดับตารางไม่เคยมี DELETE** ให้ anon/authenticated
--          (มีแค่ SELECT/INSERT/UPDATE · service_role เท่านั้นที่ลบได้)
--   ⇒ RLS "ผ่าน" แต่ Postgres ปฏิเสธที่ชั้นสิทธิ์ตาราง ⇒ PostgREST ตอบ **401**
--   เดิมโค้ดเขียนอะไหล่แบบ insert ล้วน (ไม่เคยยิง DELETE) ช่องโหว่นี้จึงมองไม่เห็นมา 1 ปี
--   พอ 22/10 เปลี่ยนเป็น delete-then-insert (คอมมิท 8134dc1) ⇒ DELETE ล้มทุกครั้ง
--   ⇒ ข้ามการเขียนรายการ **แต่โค้ดเดินไปตัดสต็อกต่อ**
--
-- วัดจริง 02/11 (edge_logs 01/11 วันเดียว): DELETE /rest/v1/mtn_order_parts → 401 จำนวน 49 ครั้ง
--   เทียบ DELETE /rest/v1/mtn_order_labor → 204 (ตารางพี่น้องที่มี GRANT ครบ)
--   แถวใหม่ใน mtn_order_parts: 22/10 = 5 แถว · 23/10–02/11 = **0 ทุกวัน**
--   ของที่ออกจากคลังไปแล้วโดยใบ MO ไม่มีบันทึก: 45 ใบ · 98 รายการ (ไม่มีรายการคืนเลย)
--
-- ตรวจทั้งฝั่ง DR แล้ว: 52 ตารางที่ client เรียก `.delete()` — ขาด GRANT ตัวนี้ **ตัวเดียว**
--
-- ย้อนกลับ: revoke delete on public.mtn_order_parts from anon, authenticated;
--           (ส่วนแถวที่กู้คืน ดูตาราง archive.mtn_order_parts_backfill_20261102)

-- ① ปิดช่องโหว่สิทธิ์ — ให้ตรงกับ `mtn_order_labor` ซึ่งเป็นตารางพี่น้องที่ใช้ flow เดียวกัน
grant delete on public.mtn_order_parts to anon, authenticated;

-- ② กู้รายการอะไหล่ 98 รายการจาก ledger สต็อก (ตัวเดียวที่เหลือรอด)
--    🔴 เก็บสำเนาสิ่งที่เขียนไว้ใน schema `archive` ก่อนเสมอ (กฎ CLAUDE.md §Database Schema)
create schema if not exists archive;

create table if not exists archive.mtn_order_parts_backfill_20261102 as
select t.id              as txn_id,
       t.ref_order_id    as order_id,
       o.mo_no,
       o.mtn_dept,
       t.part_id,
       sp.name           as part_name,
       abs(t.qty)        as qty,            -- ledger เก็บ issue เป็นค่าลบ
       sp.unit,
       sp.unit_price     as unit_price_at_restore,   -- ราคา ณ วันกู้ (ราคาตอนเบิกจริงไม่มีเก็บไว้)
       t.by_name,
       t.created_at      as issued_at,
       now()             as restored_at
from mtn_stock_txns t
join mtn_orders o       on o.id = t.ref_order_id
join mtn_spare_parts sp on sp.id = t.part_id
where t.ref_order_id is not null
  and t.type = 'issue'
  and t.created_at >= '2026-10-22'
  and not exists (select 1 from mtn_order_parts mp where mp.order_id = t.ref_order_id);

-- 🔴 เขียน **1 แถวต่อ 1 รายการตัดสต็อก** ไม่ใช่ยอดรวมต่ออะไหล่
--    ของที่ถูกตัด 2 ครั้ง (O-MTN.2026/10-52 · SAFETY LASER SCANNER 2 ครั้ง) จะขึ้น 2 บรรทัด
--    = ตรงกับที่ออกจากคลังจริง · ให้ทีมเห็นแล้วตัดสินเองว่าต้องคืนของเข้าคลังไหม (ห้ามเดาแทน)
-- 🔴 รายการที่ช่างพิมพ์ชื่อเอง (ไม่ผูกทะเบียน) ไม่เคยแตะสต็อก ⇒ **กู้ไม่ได้ ไม่มีร่องรอยที่ไหนเลย**
insert into mtn_order_parts (order_id, part_id, part_name, qty, unit, tech, logged_by, logged_at, unit_price, amount)
select b.order_id, b.part_id, b.part_name, b.qty, b.unit,
       nullif(o.tech_main, ''),
       b.by_name,
       b.issued_at,
       b.unit_price_at_restore,
       case when b.unit_price_at_restore is not null then b.unit_price_at_restore * b.qty end
from archive.mtn_order_parts_backfill_20261102 b
join mtn_orders o on o.id = b.order_id
where not exists (select 1 from mtn_order_parts mp where mp.order_id = b.order_id);
