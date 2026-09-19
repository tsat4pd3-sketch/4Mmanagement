-- 20260919_clear_trial_open_shipping_orders.sql · project: DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- คำสั่ง user 2026-09-19: *"ช่วยล้างใบที่ไม่ได้ส่งของ สำหรับอดีตให้ที ตอนนี้ทีม delivery เริ่มใช้แล้ว
--   เค้ากดส่งงานแล้ว แต่ก่อนเค้าใช้มันจะแดงๆ อยากให้เคลียร์ให้ก่อน"*
--   บริบท: ระบบยังเป็น **trial** — go-live สิ้นเดือน ก.ย. 2026 · ข้อมูลเก่าแก้ได้จนถึง cutoff
--
-- ทำไมต้อง "ลบ" ไม่ใช่ตั้งสถานะ cancelled:
--   ทั้งระบบนิยาม "จบงาน" ด้วย `status = 'shipped'` จุดเดียว — RundownStock · FlowTower ·
--   Dashboard · DeptDashboard · ProductionPlan · WipBetweenSteps · CustomerDemand กรองด้วย
--   `neq('status','shipped')` รวม ~10 จุด (มีคอมเมนต์กำกับไว้ที่ CustomerDemand.jsx:254 ว่าห้ามเปลี่ยน)
--   ⇒ เพิ่มสถานะ 'cancelled' ก่อน go-live = ต้องไล่แก้ครบทุกจุด ตกจุดเดียว = ใบยังแดงเงียบๆ
--   ของ trial ที่ไม่มีการเคลื่อนไหวสต็อกเลย จึง**ลบ + สำรอง** ปลอดภัยกว่า และไม่ต้องแตะโค้ดสักบรรทัด
--   ⚠️ หลัง go-live ถ้าต้องการ "ยกเลิกใบ" จริงๆ ต้องทำเป็นฟีเจอร์ (แก้ทุกจุดพร้อมกัน) ห้ามลบข้อมูลจริง
--
-- แยก 2 กองตาม "ของออกจากคลังไปแล้วหรือยัง" (ผลรันจริง 19/09 · รวม 561 ใบ):
--   กอง A =   8 ใบ / 435 ชิ้น — status 'prepared' และ **มี line_stock_transactions (consume)**
--             ⇒ ของถูกเบิกออกจากคลังไปแล้วจริง (note ของ txn เขียน "ส่งลูกค้า <ship-to> · <เวลา> · PO …")
--             แค่หน้างานไม่ได้กดปุ่มส่ง ⇒ **ห้ามลบ** ลบแล้ว txn จะลอย/ยอดสต็อกเพี้ยน
--             → ปิดเป็น shipped ย้อนหลัง โดยใช้เวลาของ txn เป็น shipped_at (ไม่ได้เดาเวลาเอง)
--   กอง B = 553 ใบ (538 pending · 9 confirmed · 4 prepared · 2 loaded) — **ไม่มีการเคลื่อนไหวสต็อกเลย**
--             ⇒ ลบ (สำรองครบทุกคอลัมน์ก่อน)
--
-- 🔒 ไมเกรชันนี้ **ไม่แตะ line_stock_transactions เลยสักแถว** — ยอด FG ก่อน/หลังเท่ากันเป๊ะ
-- ตรวจหลังรัน: ใบค้างในอดีต = 0 · txn ที่ชี้ใบที่ไม่มีแล้ว (orphan) = 0 · สำรองไว้ 561 ใบ
--
-- ⚠️ ยังไม่ได้แตะ: ใบอนาคต 1,376 ใบที่ **ไม่มี ship_time** (ต.ค. 2026 → ก.ย. 2027 · 2.02 ล้านชิ้น)
--    = แถว forecast ระยะยาวที่ไหลเข้ามาเป็นใบส่งของ — จะทยอยกลายเป็นสีแดงวันต่อวัน
--    ต้องแก้ที่ "ตัวนำเข้า 862" ก่อน go-live ไม่งั้นบอร์ดแดงซ้ำ (ดู logistic-planner-sales.md)

create table if not exists _bak_20260919_trial_open_orders (like customer_shipping_orders including all);

-- ── กอง A : เบิกของออกแล้ว → ปิดย้อนหลัง ────────────────────────────────
create temp table _fix_a as
select c.id, (select min(t.created_at) from line_stock_transactions t where t.ref_shipment_id = c.id) at_
  from customer_shipping_orders c
 where c.due_date < current_date and c.status <> 'shipped'
   and exists (select 1 from line_stock_transactions t where t.ref_shipment_id = c.id);

insert into _bak_20260919_trial_open_orders
select c.* from customer_shipping_orders c join _fix_a a on a.id = c.id;

update customer_shipping_orders c
   set status     = 'shipped',
       shipped_at = coalesce(c.shipped_at, a.at_),
       shipped_by = coalesce(c.shipped_by, 'เคลียร์ trial 19/09'),
       note       = concat_ws(' · ', nullif(c.note,''),
                    'ปิดย้อนหลัง (trial): เบิกของออกจากคลังแล้ว แต่ไม่ได้กดส่ง')
  from _fix_a a where a.id = c.id;

-- ── กอง B : ไม่มีการเคลื่อนไหวสต็อก → ลบ ─────────────────────────────────
create temp table _del_b as
select c.id from customer_shipping_orders c
 where c.due_date < current_date and c.status <> 'shipped'
   and not exists (select 1 from line_stock_transactions t where t.ref_shipment_id = c.id);

insert into _bak_20260919_trial_open_orders
select c.* from customer_shipping_orders c join _del_b b on b.id = c.id;

delete from customer_shipping_orders where id in (select id from _del_b);

-- ── ROLLBACK (รันบน DR "Product DB" eyhclzkifitbhbljgoav) ────────────────
-- กอง B คืนใบ:
--   insert into customer_shipping_orders
--   select * from _bak_20260919_trial_open_orders b
--    where not exists (select 1 from customer_shipping_orders c where c.id = b.id);
-- กอง A คืนสถานะเดิม:
--   update customer_shipping_orders c
--      set status=b.status, shipped_at=b.shipped_at, shipped_by=b.shipped_by, note=b.note
--     from _bak_20260919_trial_open_orders b
--    where b.id=c.id and b.status <> 'shipped';
-- ตารางสำรองลบได้เมื่อผ่าน go-live แล้วยืนยันว่าไม่ต้องย้อน:
--   drop table _bak_20260919_trial_open_orders;
