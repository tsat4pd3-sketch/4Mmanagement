-- ══ 🧹 ล้างใบ 862 ที่ e-SMART ยืนยันแทนไปแล้ว (ของค้างก่อนแก้กติกาจับคู่) ═════════════
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ที่มา (user 2026-09-09): *"ที่แดงช่วงเช้า เราจะเอายังไงกับมันดี ถ้าเค้าอัพโหลด e-SMART
-- เข้ามา แล้วไม่มีการยืนยันออเดอร์ ในช่วงนั้นให้ตรงหรือใกล้เคียงกับ 862 เราจะแก้ยังไง"*
-- user เคาะกติกา: **e-SMART อัพเดทใบ 862 ในเที่ยวนั้น ไม่สร้างรอบใหม่**
--
-- โค้ดแก้แล้ว (planOrderUpdates: ใกล้เที่ยวรถที่สุด + เคลมได้ครั้งเดียว) แต่ใบที่เกิด
-- **ก่อนแก้** ยังค้างเป็นคู่ซ้อน: ใบ e-SMART ส่งไปแล้ว คู่กับใบ 862 รอบใกล้กันที่ค้าง pending
-- ⇒ ยอดถูกนับ 2 เท่า (RundownStock / Production Plan / coverage อ่านใบ 862 เป็นดีมานด์จริง)
--   และใบ 862 จะแดงค้างตลอดกาลเพราะไม่มีวันถูกยืนยัน
--
-- วัดจริง AAT (GRBNA) 2026-09-09 — 8 คู่ (แดงค้าง 395 ชิ้น คู่กับที่ส่งจริงไปแล้ว 290 ชิ้น):
--   862 08:00  50 / 50 / 70   ↔  e-SMART 09:00  30 / 30 / 35
--   862 10:00  60 / 50        ↔  e-SMART 11:00  40 / 40
--   862 15:30  40 / 40 / 35   ↔  e-SMART 15:00  40 / 40 / 35   ← ยอดตรงกันเป๊ะ
--   (862 13:00 ถูกอัพเดทในใบเดิมถูกต้องแล้ว · 13:00 ของ 10105769 และรอบ 22:00 ไม่มีคู่ = คงไว้)

/* ── ① คู่ที่จะจัดการ — กติกาเดียวกับ `planOrderUpdates` เป๊ะ ─────────────────────────
   ⚠️ ห้าม hardcode เวลา/ไอดี — เกณฑ์ต้องตรงกับโค้ด ไม่งั้นรันซ้ำวันหลังแล้วผลไม่ตรงกัน
   เกณฑ์ปลอดภัยของฝั่ง 862 ที่จะถูกลบ:
     ⓐ `source='edi_862'` เท่านั้น (ไม่แตะใบ e-SMART / คีย์มือ)
     ⓑ `status='pending'` — ยังไม่มีใครเตรียม/โหลด/ส่ง
     ⓒ `pull_batch_id is null` — ยังไม่เคยถูก e-SMART อัพเดทในใบเดิม (ใบพวกนั้นถูกต้องแล้ว)
     ⓓ ไม่มีแถวหักสต็อกผูกอยู่ (`line_stock_transactions.ref_shipment_id`)
     ⓔ จับคู่ 1:1 กับใบ e-SMART ของ **ลูกค้า+วัน+MAT เดียวกัน** ที่ห่างกัน −150..+45 นาที
        (= MATCH_BACK_MS / MATCH_FWD_MS ใน src/utils/pullSignal.js) · ใกล้สุดชนะ */
create temporary table _esmart_supersede on commit drop as
with o as (
  select id, customer, due_date, ship_time, mat_no, qty, plan_qty, status, source, pull_batch_id,
         (due_date + ship_time::time
            + case when split_part(ship_time, ':', 1)::int < 8
                   then interval '1 day' else interval '0' end) as at
    from public.customer_shipping_orders
   where ship_time ~ '^[0-9]{1,2}:[0-9]{2}'          -- ไม่ระบุเวลา = จับคู่ไม่ได้ ห้ามเดา
),
es as (select * from o where source = 'esmart'),
p862 as (
  select o.* from o
   where o.source = 'edi_862' and o.status = 'pending' and o.pull_batch_id is null
     and not exists (select 1 from public.line_stock_transactions t where t.ref_shipment_id = o.id)
),
pair as (
  select e.id as es_id, e.plan_qty as es_plan_qty,
         p.id as p_id, p.qty as p_qty, p.ship_time as p_time, p.mat_no, p.customer, p.due_date,
         row_number() over (partition by e.id order by abs(extract(epoch from (p.at - e.at))), p.at) as rn_p,
         row_number() over (partition by p.id order by abs(extract(epoch from (p.at - e.at))), e.at) as rn_e
    from es e
    join p862 p
      on p.customer = e.customer and p.due_date = e.due_date and p.mat_no = e.mat_no
     and (p.at - e.at) between interval '-150 minutes' and interval '45 minutes'
)
select es_id, es_plan_qty, p_id, p_qty, p_time, mat_no, customer, due_date
  from pair where rn_p = 1 and rn_e = 1;

-- 👀 ดูรายการที่จะโดนก่อน (คิวรีนี้ไม่เปลี่ยนอะไร)
select customer, due_date, mat_no, p_time as "862_รอบที่จะลบ", p_qty as "862_ชิ้น"
  from _esmart_supersede order by due_date, p_time, mat_no;

/* ── ② เก็บ "แผนเดิมของ 862" ไว้บนใบ e-SMART ก่อนลบ ────────────────────────────────
   `plan_qty` = ยอดตาม 862 · `qty` = ยอดที่ลูกค้ายืนยันจริง (กติกาเดิมของโมดูล)
   ⇒ ประวัติ "แผน vs ลูกค้าเรียกจริง" ไม่หายไปพร้อมใบที่ลบ
   เขียนเฉพาะใบที่ `plan_qty` ยังว่าง ⇒ รันซ้ำได้ ไม่ทับของที่ถูกต้องอยู่แล้ว */
update public.customer_shipping_orders o
   set plan_qty = s.p_qty
  from _esmart_supersede s
 where o.id = s.es_id and o.plan_qty is null;

/* ── ③ ลบใบ 862 ที่ซ้ำซ้อน ─────────────────────────────────────────────────────────
   เงื่อนไขซ้ำอีกชั้นตรงนี้ด้วย (ไม่พึ่ง temp table อย่างเดียว) — กันกรณีมีคนกดเตรียมของ
   ระหว่างที่ยังไม่ได้รันคำสั่งนี้ ⇒ ใบที่มีคนแตะแล้วจะรอดโดยอัตโนมัติ ให้คนตัดสินเอง */
delete from public.customer_shipping_orders o
 using _esmart_supersede s
 where o.id = s.p_id
   and o.source = 'edi_862'
   and o.status = 'pending'
   and o.pull_batch_id is null
   and not exists (select 1 from public.line_stock_transactions t where t.ref_shipment_id = o.id);

/* ══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════════════
-- ต้องได้ 0 แถว (ไม่มีใบ 862 ค้างที่ e-SMART ยืนยันแทนไปแล้ว)
-- ⚠️⚠️ **คิวรีตรวจต้องเข้มเท่าคิวรีที่เขียนจริง** — พลาดจริง 2026-09-09 สองรอบซ้อน:
--   รอบ 1: เขียนเช็คแบบ "อยู่ในระยะของใบ e-SMART ใบไหนก็ได้" (ไม่มี rn_p/rn_e)
--   รอบ 2: ใส่ rn_p/rn_e แล้ว **แต่ยังฟ้องอยู่** เพราะการจับคู่เป็นแบบ *โลภตามสถานะปัจจุบัน*:
--          พอใบ 15:30 ถูกลบไป ใบ 13:00 ก็เลื่อนขึ้นมาเป็น "ใบที่ใกล้เที่ยว 15:00 ที่สุด" แทน
--          ⇒ รันเช็คซ้ำหลังลบ ได้คำตอบคนละชุดกับตอนลบเสมอ
--   ⇒ ต้องกันใบ e-SMART ที่ **กินใบ 862 ไปแล้ว** ออกจากการจับคู่ — เครื่องหมายคือ `plan_qty is not null`
--      (ขั้น ② เขียนไว้ให้) · ไม่งั้นใบ e-SMART ใบเดิมจะวนหาคู่ใหม่ไม่รู้จบ
-- 🔴 บทเรียน: **คิวรีตรวจที่หลวมกว่าคิวรีที่เขียนจริง = ฟ้องผิด แล้วคนจะไปลบของที่ถูกต้องทิ้ง**
--    คิวรีตรวจของงานลบข้อมูลต้องเขียนคู่กับคิวรีลบ และทดสอบว่า "รันหลังลบแล้วได้ 0 จริง"
with o as (
  select id, customer, due_date, mat_no, status, source, pull_batch_id, plan_qty,
         (due_date + ship_time::time + case when split_part(ship_time,':',1)::int < 8
            then interval '1 day' else interval '0' end) as at
    from public.customer_shipping_orders where ship_time ~ '^[0-9]{1,2}:[0-9]{2}'),
pair as (
  select p.id as p_id, p.mat_no, p.due_date,
         row_number() over (partition by e.id order by abs(extract(epoch from (p.at - e.at))), p.at) as rn_p,
         row_number() over (partition by p.id order by abs(extract(epoch from (p.at - e.at))), e.at) as rn_e
    from o e join o p
      on e.source='esmart' and e.plan_qty is null          -- ← ใบที่กินคู่ไปแล้ว ห้ามหาคู่ใหม่
     and p.customer=e.customer and p.due_date=e.due_date and p.mat_no=e.mat_no
     and (p.at - e.at) between interval '-150 minutes' and interval '45 minutes'
   where p.source='edi_862' and p.status='pending' and p.pull_batch_id is null
     and not exists (select 1 from public.line_stock_transactions t where t.ref_shipment_id = p.id))
select p_id, mat_no, due_date from pair where rn_p = 1 and rn_e = 1;
-- ✅ วัดจริง 2026-09-09 หลังรัน: 0 แถว (ใบ 13:00 ของ 10105769 คงอยู่ถูกต้อง — เที่ยว 13:00
--    ไม่มีพาร์ทนี้ในไฟล์ = ตรงกับ 862 ส่ง 70 ตามแผน)

-- ใบ e-SMART ต้องมี plan_qty (ยอด 862 เดิม) ติดมาแล้ว
select mat_no, ship_time, qty as "ลูกค้ายืนยัน", plan_qty as "862 เดิม"
  from public.customer_shipping_orders
 where source='esmart' and customer='GRBNA' and due_date='2026-09-09' order by ship_time, mat_no;

   ══ ROLLBACK ═══════════════════════════════════════════════════════════════════
   ⚠️ ใบที่ลบไปแล้วกู้จาก migration นี้ไม่ได้ — แต่เป็นใบ pending ที่ไม่เคยผูกสต็อก
      และยอดจริงถูกเก็บไว้ครบบนใบ e-SMART (`qty` + `plan_qty`) แล้ว
   ถ้าต้องการยอด 862 กลับมาเป็นใบแยก ให้อัพไฟล์ 862 ของวันนั้นซ้ำ
      (ตัว replace ลบเฉพาะ source='edi_862' AND status='pending' — ใบ e-SMART ที่ confirmed ขึ้นไปไม่โดน)
   คืน plan_qty:  update public.customer_shipping_orders set plan_qty = null
                   where source='esmart' and due_date='2026-09-09';
══════════════════════════════════════════════════════════════════════════════════ */
