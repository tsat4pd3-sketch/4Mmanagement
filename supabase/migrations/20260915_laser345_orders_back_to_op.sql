-- 🔴 LASER-345: ใบผลิตถูกเปิดบน "เลขคอยล์" 50031601/02 อีกรอบ — ย้ายกลับเข้าชั้น OP + ปิดเลขคอยล์ไม่ให้เลือก  (DR)
--
-- ที่มา (user ถาม 2026-09-15 จากจอ /products): "ข้อมูลที่เคยลงผิดบนเบอร์ 500x ย้ายมาใส่ OP ได้มั้ย"
--
-- ⚠️ นี่คือ **การกลับมาเป็นซ้ำ** ของเคส 2026-08-21 (`20260821_laser345_own_op_numbers.sql`)
--    รอบนั้นย้ายใบผลิต 12 ใบไปเลข OP ใหม่ `90031603`/`90031604` แล้วก็จริง
--    แต่ **ปล่อยแถว dr_products ของ 50031601/02 ไว้ is_active=true** (ตั้งใจ "ไม่ลบ" แต่ลืมปิด)
--    → dropdown "✍️ เปิดเป้าผลิต (ไม่มีบาร์โค้ด)" ใน /daily-report โชว์ทุกสินค้าของ family ไลน์
--      (DailyReport.jsx ~4769 — ไม่กรอง is_operation) ⇒ เลขคอยล์ยังอยู่ในลิสต์คู่กับเลข OP
--    → 21/08 กะดึกเป็นต้นมา หน้างานกลับไปเลือกเลขคอยล์อีก · **29+29 ใบ (26,383 ชิ้น) ถึง 15/09**
--      ขณะที่เลข OP จริงหยุดรับใบตั้งแต่ 24/08
--    ผลเสียเดิมทุกข้อกลับมา: เลขเดียว 2 ความหมาย · ยอดผลิตไม่ยุบเข้าพาร์ทจริง (collapseOps ข้าม
--    เพราะ is_operation=false) · StoreLotQueue อ่าน routing ของคอยล์เป็น "ผลิตที่ LASER-345" ทั้งที่เป็นของซื้อ
--
-- ✅ ตรวจแล้วว่าไม่มียอดซ้อน: 17–24/08 ใบวิ่งบนเลข OP · 21/08 กะดึก + ตั้งแต่ 24/08 กะดึก วิ่งบนเลขคอยล์
--    ไม่มีกะไหนที่เปิดทั้งสองเลขพร้อมกัน ⇒ ย้ายแล้วยอดไม่บวกเกิน
--
-- ⚠️ ไม่แตะตัวตน "คอยล์" ของ 50031601 เด็ดขาด — parts_master 1 แถว · bom_items 11 สูตร ·
--    purchase_requests 1,904 ใบ · kanban_standards (min 3000/max 4500 lot 100) · line_stock_* (P409/P411)
--    · child_lot_requests 21 — ทั้งหมดคือวัตถุดิบจริงที่ซื้อเข้ามา ถูกต้องอยู่แล้ว
--    (50031602 ไม่มีตัวตนในทะเบียนไหนเลย — เป็นเลขที่ถูกกุขึ้นคู่กับ 01 เพื่อเปิดใบฝั่ง LH)

-- 0) snapshot ก่อนแก้ (ย้อนได้ทุกแถว)
create table if not exists public.prod_orders_bak_laser345_20260915 as
  select * from public.prod_orders where mat_no in ('50031601','50031602');
create table if not exists public.dr_products_bak_laser345_20260915 as
  select * from public.dr_products where mat_no in ('50031601','50031602','90031603','90031604');
create table if not exists public.downtime_bak_laser345_20260915 as
  select * from public.downtime_logs where mat_no in ('50031601','50031602');
create table if not exists public.scrap_items_bak_laser345_20260915 as
  select * from public.scrap_report_items where mat_no in ('50031601','50031602');

-- 1) ย้าย "ข้อมูลที่เคยลงไว้" จากแถวคอยล์ → แถว OP (เติมเฉพาะช่องที่ OP ยังว่าง ไม่ทับของเดิม)
--    OP 90031603/04 ถูกสร้างจาก migration 21/08 แบบมีแต่โครง (p_no/customer/target/รูป = null)
--    ของพวกนี้คนกรอกไว้ที่แถวคอยล์ → ย้ายมาให้ใบงาน/บอร์ด/ใบตรวจแสดงครบเหมือนเดิม
--    RH: 50031601 (MB3B-16C275-CC) → 90031603 · LH: 50031602 (MB3B-16C274-CC) → 90031604
update public.dr_products op
   set p_no             = coalesce(op.p_no, src.p_no),
       customer         = coalesce(op.customer, src.customer),
       target_per_shift = coalesce(op.target_per_shift, src.target_per_shift),
       image_url        = coalesce(op.image_url, src.image_url),
       cycle_time_sec   = coalesce(op.cycle_time_sec, src.cycle_time_sec)
  from public.dr_products src
 where (op.mat_no, src.mat_no) in (('90031603','50031601'), ('90031604','50031602'));

-- 2) ใบผลิต 58 ใบ (21/08–15/09 · รวมใบที่ยังเปิดค้างของกะเช้า 15/09 อีก 2 ใบ) → เลข OP
--    defect_logs ผูกด้วย prod_order_id จึงตามไปเอง ไม่ต้องแก้
update public.prod_orders set mat_no = '90031603' where mat_no = '50031601';
update public.prod_orders set mat_no = '90031604' where mat_no = '50031602';

-- 3) Downtime ที่ลงไว้ใต้เลขคอยล์ — ย้ายเฉพาะที่เกิดในกะของ LASER-345 (เป็นของขั้นตัดเลเซอร์จริง)
--    ⚠️ ไม่แตะแถว HYDROFORM 01/07 ของ 50031602 (1 แถว 390 นาที) — เกิดก่อนแถวคอยล์ถูกสร้าง 17/08
--       สาเหตุจริงไม่ชัด ห้ามเดาว่าเป็นของขั้นไหน (ข้อมูลอยู่ใน downtime_bak_... ถ้าจะตามทีหลัง)
update public.downtime_logs d set mat_no = '90031603'
 where d.mat_no = '50031601'
   and exists (select 1 from public.production_sessions s where s.id = d.session_id and s.line_name = 'LASER-345');
update public.downtime_logs d set mat_no = '90031604'
 where d.mat_no = '50031602'
   and exists (select 1 from public.production_sessions s where s.id = d.session_id and s.line_name = 'LASER-345');

-- 4) ใบรายงานของเสีย 20/08 (2 แถว · in_process ของขั้นตัดเลเซอร์) → เลข OP
update public.scrap_report_items set mat_no = '90031603' where mat_no = '50031601';
update public.scrap_report_items set mat_no = '90031604' where mat_no = '50031602';

-- 5) ปิดแถว "สินค้า" ของเลขคอยล์ ไม่ให้ถูกเลือกเปิดใบได้อีก (คำสั่ง user 15/09 "deactivate 2 อันนั้นที่ไม่ใช้ออก")
--    · /daily-report โหลด dr_products ด้วย .eq('is_active', true) ⇒ หายจาก dropdown เปิดเป้าทันที
--    · คอยล์ยังเบิก/ซื้อ/เข้า BOM ได้ปกติ — ของพวกนั้นอ่าน parts_master/bom_items ไม่ได้อ่านแถวนี้
--    · เคลียร์ pair_mat_no ด้วย: คู่ RH/LH เป็นความจริงของ "ขั้นผลิต" ไม่ใช่ของคอยล์
--      (คู่ตัวจริงอยู่ที่ 90031603 ↔ 90031604 แล้ว)
update public.dr_products
   set is_active = false, pair_mat_no = null
 where mat_no in ('50031601', '50031602');

-- Rollback (เรียงตามนี้):
--   update public.dr_products d set is_active = b.is_active, pair_mat_no = b.pair_mat_no
--     from public.dr_products_bak_laser345_20260915 b where b.mat_no = d.mat_no;
--   update public.scrap_report_items s set mat_no = b.mat_no
--     from public.scrap_items_bak_laser345_20260915 b where b.id = s.id;
--   update public.downtime_logs d set mat_no = b.mat_no
--     from public.downtime_bak_laser345_20260915 b where b.id = d.id;
--   update public.prod_orders o set mat_no = b.mat_no
--     from public.prod_orders_bak_laser345_20260915 b where b.id = o.id;
--   -- (ช่องที่เติมให้ OP ในข้อ 1 ย้อนได้จาก dr_products_bak_laser345_20260915 เช่นกัน)
