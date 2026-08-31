-- 🔴 เลขคอยล์ 50031601/02 ถูกเอาไปใช้เป็น "ขั้นตอนตัดเลเซอร์" — คืนให้เป็นวัตถุดิบ  (DR)
--
-- ที่มา (user ถาม 2026-08-21): "งง 500 เป็นเลข raw material แล้วคือโดนคนไปสร้างเป็นกระบวนการผลิตหรอ"
--   → ใช่ · ไล่จาก audit_log ได้ลำดับเหตุการณ์ครบ:
--     15/06  `50031601` เข้า parts_master เป็นคอยล์ WSS-M1A367-A36 (ชิ้น · 100/กล่อง)
--     25/06–14/08  ถูกใช้เป็นวัตถุดิบใน **BOM 9 สูตร**
--     17/08 09:48  migration ติดธง OP ให้ `90031601`/`90031602` · parent ของ 90031601 = `10100385` ✅
--     17/08 10:09  สุวิทย์ชัย **สร้างแถว dr_products ของ `50031601`/`50031602` แล้วติดธง is_operation ในวินาทีเดียวกัน**
--                  (ต้องการให้ LASER-345 มีใบงานของตัวเอง เลยหยิบเลขคอยล์มาใช้เป็นชื่อขั้น)
--     19/08 02:43  ตั้ง `50031601.op_parent_mat = 50031601` (ชี้ตัวเอง)
--     19/08 03:17  ย้าย parent ของ `90031601`/`90031602` จาก `10100385` → `50031601`  ← ทำให้ OP ชี้ OP
--     19/08 03:37  ล้าง parent ที่ชี้ตัวเองออก
--
--   ผลเสีย 3 อย่าง:
--     1. เลขเดียวมี 2 ความหมาย (คอยล์ที่ซื้อเข้า vs ขั้นตอนที่ผลิต)
--     2. ติดธง OP แล้ว **BOM picker กรองทิ้ง** → เลือกคอยล์ตัวนี้เข้าสูตรใหม่ไม่ได้
--        และ `fn_post_confirmed_output` ข้ามไม่ให้เข้าคลัง (กฎ OP ห้ามเข้าสต๊อก)
--     3. `op_parent_mat` ชี้ไป OP ด้วยกัน → `collapseOps` ยุบยอดไม่ถูก (parent ต้องเป็น "พาร์ทจริง" เสมอ)
--
-- ทางแก้ที่ user เคาะ 2026-08-21: **"เอา ทำเลยรันเลขต่อจากเดิม"**
--   → ให้ขั้นเลเซอร์มีเลขของตัวเองต่อจากชุดเดิม `90031603` (RH) / `90031604` (LH)
--     (เบอร์ 900 = เลขภายในที่ตั้งเองได้ ตามกติกา MAT prefix ใน CLAUDE.md)
--   → คืน parent ของ `90031601`/`90031602` กลับเป็นพาร์ทจริงตามที่ออกแบบไว้เดิม
--   → ปลดธง OP ของ `50031601`/`50031602` ให้กลับเป็นวัตถุดิบล้วน
--
-- ⚠️ ไม่ลบแถว dr_products ของ 50031601/02 — แค่ปลดธง (ใบผลิตเก่าถูกย้ายไปเลขใหม่แล้ว
--    และการลบจะพา p_no / pair ที่คนตั้งไว้หายไปด้วย ซึ่งไม่ได้อยู่ในขอบเขตที่ user สั่ง)
-- ⚠️ ไม่แตะ parts_master / bom_items (9 สูตร) / kanban_standards / สต๊อก ของ 50031601 — นั่นคือตัวตนคอยล์ที่ถูกต้องอยู่แล้ว

-- 1) ขั้นตอนตัดเลเซอร์ที่ LASER-345 ได้เลขของตัวเอง
--    parent = "พาร์ทจริงที่ขั้นนี้ผลิตไปหา" (ไม่ใช่ขั้นก่อนหน้า) ตามกฎชั้น Operation ใน CLAUDE.md
--    RH → 10100385 (REINF ASY FRT FNDR INR BDY RH · Line 60)
--    LH → 20065715 (REINF FRT FNDR 274 ก่อนแพ็ค) — คู่เดียวกับที่ 90031602 ใช้
insert into public.dr_products (mat_no, name, line_name, cycle_time_sec, process_type,
                                is_operation, op_parent_mat, op_seq, pair_mat_no, is_active)
select v.mat_no, v.name, 'LASER-345', 45, 'laser_cutting', true, v.parent, 20, v.pair, true
  from (values
    ('90031603', 'WSS-M1A367-A36 50G50G 2.0 X 76.20 X 1600 RH (ตัดเลเซอร์ LS345)', '10100385', '90031604'),
    ('90031604', 'WSS-M1A367-A36 50G50G 2.0 X 76.20 X 1600 LH (ตัดเลเซอร์ LS345)', '20065715', '90031603')
  ) as v(mat_no, name, parent, pair)
 where not exists (select 1 from public.dr_products d where d.mat_no = v.mat_no);

-- 2) ย้ายใบผลิตของ LASER-345 มาใช้เลขใหม่ (12 ใบ · ในนั้นเปิดค้างอยู่ 2 ใบของวันนี้)
--    ⚠️ ต้องทำหลังข้อ 1 เสมอ — ไม่งั้นใบไปอ้างเลขที่ยังไม่มีในทะเบียนสินค้า
update public.prod_orders set mat_no = '90031603' where mat_no = '50031601';
update public.prod_orders set mat_no = '90031604' where mat_no = '50031602';

-- 3) คืน parent ของขั้น HYDROFORM กลับเป็นพาร์ทจริง (ถูกย้ายไปชี้ OP ด้วยกันเมื่อ 19/08)
update public.dr_products set op_parent_mat = '10100385', op_seq = coalesce(op_seq, 10) where mat_no = '90031601';
update public.dr_products set op_parent_mat = '20065715', op_seq = coalesce(op_seq, 10) where mat_no = '90031602';

-- 4) คืน 50031601/02 ให้เป็นวัตถุดิบล้วน — กลับเข้า BOM picker และเข้าคลังได้ตามปกติ
update public.dr_products
   set is_operation = false, op_parent_mat = null, op_seq = null
 where mat_no in ('50031601', '50031602');

-- Rollback:
--   update public.prod_orders set mat_no = '50031601' where mat_no = '90031603';
--   update public.prod_orders set mat_no = '50031602' where mat_no = '90031604';
--   delete from public.dr_products where mat_no in ('90031603','90031604');
--   update public.dr_products set is_operation = true where mat_no in ('50031601','50031602');
--   update public.dr_products set op_parent_mat = '50031601' where mat_no in ('90031601','90031602');
