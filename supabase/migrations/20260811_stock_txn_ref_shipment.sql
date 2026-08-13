-- ── DR project (eyhclzkifitbhbljgoav) ──
-- ปิด GAP #1 ของ traceability: ผูก "ขาตัดส่งลูกค้า" กลับไปหารอบส่งที่ทำให้เกิดการตัดนั้น
--
-- ปัญหาเดิม (บันทึกไว้ใน CLAUDE.md หัวข้อ OrderTrace "ขอบเขต/GAP"):
--   ตอนกด "ส่งแล้ว" หน้า Delivery จะ insert line_stock_transactions type='consume'
--   โดยไม่บันทึกว่ามาจากรอบส่งใบไหน → หน้า /order-trace ต้องเดาแบบ "เชิงเวลา"
--   (mat เดียวกัน + created_at หลังปิดใบ + note มีคำว่า 'ส่งลูกค้า') ซึ่งพังได้ 3 ทาง:
--     1. mat เดียวส่งหลายรอบในวันเดียว → แยกไม่ออกว่าแถวไหนของรอบไหน
--     2. ใครแก้ข้อความ note ในโค้ด = การจับคู่พังเงียบ (ผูกกับข้อความ ไม่ใช่ id)
--     3. สอบกลับจากฝั่งรอบส่งกลับมาหาใบผลิต ทำไม่ได้เลย (มีแต่ทางเดียว)
--
-- ทำไมไม่ใช้ ref_order_id ที่มีอยู่แล้ว:
--   ref_order_id = ใบผลิต (prod_orders.id) ใช้เป็นตัวกันโพสต์ซ้ำของ trigger
--   trg_post_confirmed_output และใช้ถอนแถวตอน "↩️ ถอยใบ" (ลบด้วย ref_order_id
--   + created_by='auto' + type='issue') — เอา id ของคนละ entity มาใส่คอลัมน์เดียวกัน
--   คือ polymorphic key ที่ไม่มีตัวบอกชนิด อ่านทีหลังแยกไม่ออกว่า uuid นี้ของตารางไหน
--   → แยกคอลัมน์ให้ชัด ผูก FK จริง อ่านแล้วรู้ทันทีว่าชี้ไปไหน
--
-- on delete set null: ลบรอบส่งทิ้ง (ใบคีย์มือที่ยัง pending ลบได้จากหน้า Delivery)
--   ต้องไม่ลบประวัติการตัดสต็อกตามไปด้วย — ยอดที่หักไปแล้วเป็นข้อเท็จจริงทางบัญชี
--   เสียแค่การผูกกลับ (กลับไปเป็นเดาเชิงเวลาเหมือนก่อนมี migration นี้)
--
-- PURELY ADDITIVE — คอลัมน์ nullable ไม่มี default ไม่แตะข้อมูลเดิมแม้แต่แถวเดียว
--   แถวเก่า 7 แถวที่ตัดส่งไปแล้วก่อนหน้านี้ยังเป็น null (ผูกย้อนหลังไม่ได้ เพราะ
--   ข้อมูลที่จะใช้ชี้ตัวไม่มีอยู่จริง — ห้ามเดาจับคู่ให้ ดูหมายเหตุท้ายไฟล์)

alter table line_stock_transactions
  add column if not exists ref_shipment_id uuid
    references customer_shipping_orders(id) on delete set null;

comment on column line_stock_transactions.ref_shipment_id is
  'รอบส่งลูกค้าที่ทำให้เกิดการตัดสต็อกแถวนี้ (customer_shipping_orders.id) — null = ตัดจากทางอื่น/ข้อมูลก่อน 2026-08-11';

-- partial index: ชี้เฉพาะแถวที่ผูกจริง (แถวส่วนใหญ่ในตารางเป็นขารับเข้า = null)
-- รูปแบบเดียวกับ idx_lst_ref_order ที่มีอยู่
create index if not exists idx_lst_ref_shipment
  on line_stock_transactions (ref_shipment_id)
  where ref_shipment_id is not null;

-- ── หมายเหตุ: ทำไมไม่ backfill ข้อมูลเก่า ──
-- แถว consume เดิมมี 7 แถว (10-17/07/2026) เทียบกับรอบส่งที่ status='shipped' 43 ใบ
-- การจับคู่ย้อนหลังทำได้แค่ "เดา" จาก mat + ช่วงเวลา ซึ่งเป็นวิธีเดียวกับที่ migration นี้
-- ตั้งใจจะเลิกใช้ → backfill ด้วยการเดา = เอาข้อมูลเดาไปใส่ในคอลัมน์ที่คนอ่านจะเชื่อว่าแน่นอน
-- อันตรายกว่าปล่อยว่างไว้ตรงๆ · null อ่านออกว่า "ไม่รู้" ซึ่งเป็นความจริง
