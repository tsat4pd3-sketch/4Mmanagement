-- Delivery walkback: จุดหักสต็อกเป็น "เฟส" ที่ตั้งได้ + เฟสท้ายสุด = จบงาน (2026-08-26)
--
-- ที่มา (คำสั่ง user):
--   1) "ถ้าปรับ phase สุดท้าย เป็น โหลดของขึ้นรถ ถือว่าจบงาน เพราะรถที่มารับเปนรถ milk run ของลูกค้า
--       พอคลิกโหลดของขึ้นรถก็ควรจบกระบวนการ ไม่ต้องมาเลือก ส่งถึงลูกค้าแล้วสิ"
--   2) "ปกติเราจะตัดสตอคจาก warehouse ตั้งแต่ เตรียมของไปพื้นที่ shipping area ก่อนจะโหลดขึ้นรถละนะ ใน SAP"
--
-- ⚠️ ข้อ 1 ไม่ต้องมี migration — สถานะจบใน DB ยังเป็น 'shipped' เสมอ (RundownStock/StoreMonitor/
--    FlowTower/DeptDashboard/WipBetweenSteps/shipping-phase-scan ทั้งระบบกรองด้วย neq('status','shipped'))
--    "เฟสท้ายสุด" เป็นแค่การตีความฝั่งจอว่า "คลิกไหนคือคลิกสุดท้าย" → derive จาก requires_status สูงสุด
--    ของชุดเฟสที่ active อยู่ ไม่เก็บธงใหม่ (ธงจะ drift กับตารางเฟสได้ทันทีที่มีคนเพิ่ม/ลบเฟส)
--
-- ไฟล์นี้ทำเฉพาะข้อ 2: ย้าย "จุดหักสต็อก" จากที่ hardcode ไว้ตอน shipped → เป็นเฟสที่ติ๊กได้

alter table public.shipping_workflow_steps
  add column if not exists deducts_stock boolean not null default false;

comment on column public.shipping_workflow_steps.deducts_stock is
  'เฟสนี้คือจุดที่ของถูกตัดออกจาก warehouse จริง (ให้ตรงกับ SAP) · ไม่ติ๊กเฟสไหนเลย = หักตอนจบรอบส่งเหมือนเดิม · ติ๊กหลายเฟส = ยึดเฟสที่สถานะต่ำสุด (เกิดก่อน) · หักครั้งเดียวต่อรอบส่งเสมอ กันซ้ำด้วย line_stock_transactions.ref_shipment_id';

-- ตั้งค่าตามกระบวนการจริงที่ user ยืนยัน: หักตอน "จัดเตรียมงานเสร็จ" (prepared) ของชุดมาตรฐาน
-- ⚠️ ปลอดภัยกับใบที่ค้างกลางทาง — ฝั่งแอปเช็ค ref_shipment_id ก่อนหักทุกครั้ง
--    ใบที่เลย prepared มาแล้วแต่ยังไม่เคยหัก จะถูกหักตอนกดขั้นถัดไป (ไม่หลุด) และใบที่หักไปแล้วจะไม่หักซ้ำ
update public.shipping_workflow_steps
   set deducts_stock = true
 where customer is null
   and is_active
   and requires_status = 'prepared'
   and not deducts_stock;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- alter table public.shipping_workflow_steps drop column if exists deducts_stock;
--   (แอปอ่านคอลัมน์นี้แบบ tolerant: ไม่มีคอลัมน์ = ถอยไปหักตอนจบรอบส่งเหมือนเดิม ไม่พัง)
