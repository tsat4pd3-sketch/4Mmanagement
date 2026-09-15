-- 🧩 ตัดของเสียของ "ขั้นตอน (OP)" ให้เป็นเลข SAP จริง  (DR project — eyhclzkifitbhbljgoav)
--
-- คำสั่ง user 2026-09-15 (ส่งจอ /products + ใบ scrap มาให้ดู):
--   "พอระบบไม่มี BOM ว่า OP นี้คืออะไรประกอบกัน เวลาตัด scrap เลขนี้ไม่มีใน SAP มันจะไม่ตรง
--    … มันต้องดึง BOM ที่มันประกอบมาตัด ไม่ใช่ตัดตัวมันเอง เพราะตัวมันเองยังไม่สมบูรณ์"
--
-- สถานะจริงก่อนแก้ (ตรวจ 15/09): `scrap_report_items` มี 7 แถว — **ทุกแถว**เกาะเลขที่ SAP ตัดไม่ได้
--   90031601/90031602 = ชั้น OP (HYDROFORM) · 50031601/50031602 = เลขที่เคยถูกใช้เป็นชื่อขั้น
--   ทั้งหมด stage = in_process มาจากปุ่ม "ดึงจาก Daily Report"
--
-- ⚠️ ไม่แตะแถวใบของเสียเดิม (เป็นบันทึกคุณภาพ) — เปิดใบแล้วกด 🧩 ระเบิดขั้นตอน แล้วบันทึกใหม่ได้เอง

-- ══ 1) ที่มาของแถวที่ระเบิดมา — สืบย้อนว่าบรรทัดวัตถุดิบนี้มาจากขั้นไหน ══════════════
alter table public.scrap_report_items
  add column if not exists src_op_mat text;

comment on column public.scrap_report_items.src_op_mat is
  'mat ของ "ขั้นตอน (OP)" ที่แถวนี้ถูกระเบิดออกมา (null = ของเสียของพาร์ทตรงๆ) — ใบ FM-PD2-002 พิมพ์เลขลูกเพื่อให้สโตร์ตัด SAP ได้ แต่ยังสืบกลับไปหาขั้นที่ของเสียหลุดได้ · utils/scrapExplode.js';

-- ══ 2) สูตรของขั้น — **จงใจไม่ seed ในรอบนี้ (รอ user เคาะ)** ══════════════════════════
-- เตรียม SQL ไว้ให้แล้วด้านล่าง แต่ยังไม่รัน เพราะ **ไม่ใช่ข้อมูลเงียบ**:
--   `HeijunkaKanban` (บอร์ดสโตร์ part-call) และ `LineWipPanel` อ่าน `bom_items` ด้วย `product_id`
--   ของ "ใบผลิต" ตรงๆ โดยไม่กรอง `is_operation` ⇒ วินาทีที่ขั้นมีสูตร จอสโตร์จะเริ่มขึ้นรายการ
--   "ส่งของเข้าไลน์" ให้ใบของขั้นนั้นทันที · HDF1/HDF2 เปิดใบบนเลข OP 90031601/02 **ทุกวัน**
--   (53/36/64/38 ใบใน 45 วัน) ⇒ seed = เปลี่ยนพฤติกรรมจอที่คนใช้จริง โดยที่ user ยังไม่ได้ตัดสินใจ
--   (และ `50031601` ฝั่ง LASER-345 ถูกเปิดเป็น "ตัวสินค้า" ของใบผลิตอยู่ด้วย — โมเดลยังทับกันอยู่
--    ดูเหตุการณ์ revert 15/09 ใน docs/modules/oee.md ก่อนตัดสินใจ)
-- ⇒ ฟีเจอร์ฝั่งใบของเสียใช้งานได้ทันทีโดยไม่ต้อง seed: จอจะขึ้นแถบแดงบอกว่าขั้นไหนยังไม่มีสูตร
--   แล้วให้คนไปผูกที่ /products แท็บ BOM (ซึ่งเห็นผลกระทบฝั่งสโตร์พร้อมกัน)
--
-- SQL ที่เตรียมไว้ (รันเมื่อ user เคาะ — ข้อมูลยืนยันจาก BOM ของพาร์ทปลายทาง 4 ตัวที่มี
-- `50031601` × 1 pcs เหมือนกันหมด + ผังสายใน docs/modules/oee.md):
--   insert into public.bom_items (product_id, mat_no, part_no, part_name, qty_per_unit, uom, item_no, is_active, created_by, note)
--   select p.id, s.mat_no, s.part_no, s.part_name, s.qty_per_unit, s.uom, 10, true, 'migration 20260915',
--          'สูตรของขั้น (ขั้นนี้กินอะไรเข้าไป) — ใช้ตัดของเสียให้เป็นเลข SAP'
--   from (values
--     ('90031601', '50031601', 'MB3B-16C274-CC', 'WSS-M1A367-A36 50G50G 2.0X76.20X1600', 1::numeric, 'pcs'),
--     ('90031602', '50031601', 'MB3B-16C274-CC', 'WSS-M1A367-A36 50G50G 2.0X76.20X1600', 1::numeric, 'pcs')
--   ) as s(op_mat, mat_no, part_no, part_name, qty_per_unit, uom)
--   join public.dr_products p on p.mat_no = s.op_mat and coalesce(p.is_operation, false)
--   where not exists (select 1 from public.bom_items b where b.product_id = p.id and b.mat_no = s.mat_no);
--
-- ⚠️ แถว `D04 (BOLT M6)` มีสูตรอยู่แล้ว 2 บรรทัด (คีย์โดย user จริงตั้งแต่ก่อนหน้านี้) — **ห้ามลบ**
--   เป็นหลักฐานว่าหน้างานต้องการฟีเจอร์นี้อยู่แล้ว และเป็นชุดข้อมูลจริงชุดเดียวที่ทดสอบปุ่ม 🧩 ได้ทันที

-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════════
--   select p.mat_no as op_mat, p.name, b.mat_no as consumes, b.qty_per_unit, b.uom
--     from bom_items b join dr_products p on p.id = b.product_id
--    where coalesce(p.is_operation,false) and b.is_active order by p.mat_no;
--
-- ══ Rollback ════════════════════════════════════════════════════════════════════════
--   alter table public.scrap_report_items drop column if exists src_op_mat;
--   (โค้ดฝั่งแอปถอยได้เอง: insert ของ ScrapReport จับ 42703 แล้วบันทึกชุดเดิมต่อ)
