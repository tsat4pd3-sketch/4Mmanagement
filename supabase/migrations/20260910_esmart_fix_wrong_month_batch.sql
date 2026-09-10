-- ══ 🧹 ล้างใบผีเดือน ต.ค. + ย้ายร่องรอยกลับมาวันที่ถูก (บั๊กอ่านวันที่ 10/09 เป็น 9 ต.ค.) ═══
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
--
-- ที่มา (user 2026-09-10): *"ลองอัพโหลดแล้วแต่ว่าใน schedule shipping time chart ไม่ขึ้น"*
--   → *"ลบใบผี และย้าย จากเดือนตุลามาวันนี้ และน่าจะต้องจำว่า ข้อมูลเป็น dmy"*
--
-- ⚠️ **มี 2 batch ที่โดน** (อัพก่อนโค้ดใหม่ deploy ทัน):
--    a0990367 ไฟล์ 08:04 (ช่วง 06:00-08:00 → รอบ 09:00) — ใบผี 3 ใบ · สต็อกถูกตัดซ้ำ 115 ชิ้น
--    4d07a287 ไฟล์ 10:04 (ช่วง 08:00-10:00 → รอบ 11:00) — ใบผี 3 ใบ · สต็อกถูกตัดซ้ำ 40 ชิ้น
--    ⇒ รวมคืนสต็อก FG 155 ชิ้น
--
-- บั๊ก: หัวไฟล์ส่งวันมาเป็น `10/09/2026` (วัน/เดือน) แต่โปรไฟล์ตั้ง ts_format='MDY'
--       ⇒ อ่านเป็น **9 ตุลาคม** ⇒ batch/ใบส่งไปอยู่เดือน ต.ค. (ชาร์ตวันนี้ว่าง)
--       ⇒ **สต็อก FG ถูกตัดซ้ำ 115 ชิ้น** เพราะรอบ 08:00 จริงถูกยิงซ้ำอีกใบ ห่างกัน 30 วินาที
-- แก้ตัวอ่านแล้ว (`detectDateOrder` + ไม้บรรทัด 2 ทิศ + ด่านเตือนวันที่ห่างผิดปกติ) — ไฟล์นี้ตามเก็บของที่หลุดไป
--
-- ⚠️ `pulled_at` ของแถวสัญญาณ **ถูกต้องอยู่แล้ว** (แถวในไฟล์เป็น ISO) — เพี้ยนเฉพาะ
--    `work_date` ที่คำนวณจากหัวไฟล์ ⇒ แก้เฉพาะช่องที่เพี้ยนจริง ห้าม shift ทั้งแถว

/* ── ① ลบใบผี 3 ใบ + แถวตัดสต็อกที่ผูกอยู่ (คืนยอด FG 115 ชิ้น) ─────────────────────
   ใบพวกนี้ซ้ำกับรอบ 08:00 ของจริงที่ส่งไปแล้ว (50/50/35 + PO) ซึ่งยังอยู่ครบ
   เกณฑ์: เฉพาะใบของ batch นี้ + source='esmart' เท่านั้น ⇒ ไม่มีทางแตะใบ 862/คีย์มือ
   ⚠️ ลบแถวสต็อกก่อนใบ (แถวสต็อกอ้าง ref_shipment_id) */
delete from public.line_stock_transactions t
 using public.customer_shipping_orders o
 where t.ref_shipment_id = o.id
   and o.pull_batch_id in ('a0990367-0762-4c90-bc75-791a0f169ba7', '4d07a287-af22-490f-ae1c-28c8a4fff9c9')
   and o.source = 'esmart';

delete from public.customer_shipping_orders o
 where o.pull_batch_id in ('a0990367-0762-4c90-bc75-791a0f169ba7', '4d07a287-af22-490f-ae1c-28c8a4fff9c9')
   and o.source = 'esmart';

/* ── ② ย้ายร่องรอยการนำเข้ากลับมาวันที่ถูก (10 ก.ย.) ─────────────────────────────
   เก็บ batch + signals ไว้เป็นหลักฐานว่าเคยดึงอะไรบ้าง — แค่ติดวันให้ถูก
   ⇒ แท็บ 📜 ประวัติ order เข้าระบบ จะอ่านรู้เรื่อง และตัวกันอัพซ้ำยังทำงาน */
update public.customer_pull_batches
   set work_date    = date '2026-09-10',
       window_start = timestamptz '2026-09-10 06:00:00+07',
       window_end   = timestamptz '2026-09-10 08:00:00+07',
       orders_created = 0,
       note = coalesce(note || ' · ', '') ||
              'แก้วันที่ 2026-10-09 → 2026-09-10 (บั๊กอ่าน 10/09 เป็น MDY) · ลบใบผี 3 ใบ + คืนสต็อก 115 ชิ้น'
 where id = 'a0990367-0762-4c90-bc75-791a0f169ba7';

update public.customer_pull_batches
   set work_date    = date '2026-09-10',
       window_start = timestamptz '2026-09-10 08:00:00+07',
       window_end   = timestamptz '2026-09-10 10:00:00+07',
       orders_created = 0,
       note = coalesce(note || ' · ', '') ||
              'แก้วันที่ 2026-10-09 → 2026-09-10 (บั๊กอ่าน 10/09 เป็น MDY) · ลบใบผี 3 ใบ + คืนสต็อก 40 ชิ้น'
 where id = '4d07a287-af22-490f-ae1c-28c8a4fff9c9';

-- แถวสัญญาณ: `pulled_at` ถูกอยู่แล้ว แก้เฉพาะ work_date ที่เพี้ยน
update public.customer_pull_signals
   set work_date = date '2026-09-10'
 where batch_id in ('a0990367-0762-4c90-bc75-791a0f169ba7', '4d07a287-af22-490f-ae1c-28c8a4fff9c9');

/* ── ③ จำไว้ว่าไฟล์ชุดนี้เป็น วัน/เดือน/ปี (คำสั่ง user) ───────────────────────────
   ⚠️ **นี่คือค่าสำรองเท่านั้น** — ตัวอ่านพิสูจน์ลำดับจากตัวไฟล์เองทุกครั้งและชนะค่านี้เสมอ
      (รูปแบบจริงไม่คงที่: ขึ้นกับ locale ของคนที่กดโหลดจากพอร์ทัล — ดู logistic-planner-sales.md §⑥) */
update public.customer_pull_formats
   set ts_format = 'DMY', updated_at = now()
 where code = 'ford_esmart';

/* ══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════════════
-- 1) ต้องไม่มีใบส่ง/แถวสัญญาณเหลือในเดือน ต.ค. (ต้องได้ 0 ทั้งคู่)
select count(*) from public.customer_shipping_orders where due_date  > date '2026-09-11';   -- 0
select count(*) from public.customer_pull_signals   where work_date > date '2026-09-11';   -- 0
select count(*) from public.customer_pull_batches   where work_date > date '2026-09-11';   -- 0

-- 862 ของวันนี้ต้องไม่มีใบไหนโดน e-SMART แตะเลย (ต้องได้ 0)
select count(*) from public.customer_shipping_orders
 where customer='GRBNA' and due_date='2026-09-10' and source='edi_862' and pull_batch_id is not null;

-- 2) batch ต้องเป็นวันที่ 10 ก.ย. รอบ 09:00
select file_name, work_date, ship_time, window_start, window_end, orders_created
  from public.customer_pull_batches where id='a0990367-0762-4c90-bc75-791a0f169ba7';

-- 3) รอบ 08:00 ของจริงต้องยังอยู่ครบ 3 ใบ พร้อมแถวตัดสต็อก 1 แถว/ใบ
select o.ship_time, o.mat_no, o.qty, o.status,
       (select count(*) from public.line_stock_transactions t where t.ref_shipment_id=o.id) as stock_rows
  from public.customer_shipping_orders o
 where o.customer='GRBNA' and o.due_date='2026-09-10' and o.ship_time='08:00' order by o.mat_no;

   ══ ROLLBACK ═══════════════════════════════════════════════════════════════════
   ⚠️ ใบผี + แถวตัดสต็อกที่ลบไปกู้จาก migration นี้ไม่ได้ (ตั้งใจ — มันคือยอดที่ตัดซ้ำ)
      ถ้าต้องการยอด e-SMART รอบนั้นกลับมา ให้อัพไฟล์เดิมซ้ำหลัง deploy ตัวอ่านใหม่
      (ตัวอ่านจะอ่านวันถูก แล้วรายงานว่ารอบ 08:00 "ทำไปแล้ว" ไม่สร้างใบซ้ำ)
   คืน ts_format:  update public.customer_pull_formats set ts_format='MDY' where code='ford_esmart';
══════════════════════════════════════════════════════════════════════════════════ */
