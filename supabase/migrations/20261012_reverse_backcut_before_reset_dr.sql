-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-12 · audit SSOT ยอดสต็อก
-- ปัญหา: 07/10 ปุ่ม "หักย้อนหลัง" (StockCountSheet) หักใบส่งของที่กำหนดส่ง ส.ค.–ก.ย. (ก่อนล้างยอดทั้งระบบ 01/10)
--   159 แถว / 23,476 ชิ้น ลง FG WAREHOUSE → 6 MAT ติดลบ (−24,344) ทั้งที่ของไม่เคยถูกรับเข้าระบบ
--   ต้นเหตุ: MAT ที่ไม่มีแถวในคลังตอนล้างยอด ไม่มี adjust ให้ lastCountAt เห็น ⇒ ไม่มีเส้นรอบนับ
--   (โค้ดแก้แล้ว: STOCK_BASELINE_AT ใน src/utils/stockCount.js)
-- แก้ข้อมูล: กลับรายการด้วย adjust สวนทาง (ไม่ลบประวัติ — แถว consume เดิมยังผูก ref_shipment_id อยู่
--   ใบเหล่านั้นจึงไม่กลับมาโผล่ในรายการค้างหัก) · ใบที่กำหนดส่ง ≥ 01/10 (13 แถว / 1,118) ไม่แตะ = ส่งจริงหลังตั้งต้น
insert into public.line_stock_transactions (line_name, mat_no, part_name, qty, type, status, work_date, note, created_by, storage_location)
select t.line_name, t.mat_no, max(t.part_name), sum(t.qty), 'adjust', 'approved', '2026-10-12',
       'กลับรายการ: หักย้อนหลังใบส่งก่อนวันตั้งต้นยอด 01/10 (' || count(*) || ' แถว · ทำ 07/10) — audit 12/10',
       'system (audit 12/10)', max(t.storage_location)
  from public.line_stock_transactions t
  join public.customer_shipping_orders o on o.id = t.ref_shipment_id
 where t.type = 'consume' and t.status = 'approved'
   and t.note like 'กระทบยอดย้อนหลัง%'
   and o.due_date < '2026-10-01'
   and not exists (select 1 from public.line_stock_transactions x
                    where x.type = 'adjust' and x.mat_no = t.mat_no and x.line_name = t.line_name
                      and x.note like 'กลับรายการ: หักย้อนหลังใบส่งก่อนวันตั้งต้นยอด 01/10%')
 group by t.line_name, t.mat_no;

-- เช็คผล: select mat_no, qty, note from line_stock_transactions where note like 'กลับรายการ: หักย้อนหลัง%';
--         select line_name, mat_no, qty_on_hand from line_stock_summary where line_name='FG WAREHOUSE' and qty_on_hand < 0;
-- ย้อน:   delete from line_stock_transactions where type='adjust' and note like 'กลับรายการ: หักย้อนหลังใบส่งก่อนวันตั้งต้นยอด 01/10%';
