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

-- ══ 2) สูตร "ขั้นนี้กินอะไรเข้าไป" ของสาย WSS-M1A367-A36 (พาร์ทต้นแบบ golden thread) ══
--   bom_items ที่ product_id ชี้ "แถว OP" = สูตรของขั้น (ของเดิมชี้พาร์ทจริงเท่านั้น)
--   ⚠️ ไม่ใช่การเดา — ยืนยัน 3 ทาง:
--     · BOM ของพาร์ทปลายทางทั้ง 4 ตัว (10100385 / 10100401 / 20065715 / 20065635)
--       ล้วนมีบรรทัด `50031601` × 1 pcs (part_no ระบุ "common RH/LH")
--     · ผังสายใน docs/modules/oee.md: คอยล์/บลังค์ 50031601 ─hydroform─▶ ชั้น OP ─▶ LASER ─▶ FG
--     · 50031601 คือตัวตนจริงในทะเบียน (parts_master + BOM 11 สูตร + คัมบัง min/max + สต๊อก P409/P411)
--   ⇒ ของเสีย 1 ชิ้นที่หลุดตอนไฮโดรฟอร์ม = บลังค์หายไป 1 pcs (ขั้นเลเซอร์ seq 20 ไม่ต้องคีย์ซ้ำ
--     ระบบไล่ขั้นก่อนหน้าให้เอง — กฎ delta ใน src/utils/scrapExplode.js)
--   ขั้นอื่นที่ยังไม่มีสูตร **จงใจไม่ seed** (ห้ามเดาว่าขั้นขับนัทกินนัตกี่ตัว) — จอจะเตือนให้คนไปผูกเอง
insert into public.bom_items (product_id, mat_no, part_no, part_name, qty_per_unit, uom, item_no, is_active, created_by, note)
select p.id, s.mat_no, s.part_no, s.part_name, s.qty_per_unit, s.uom, 10, true, 'migration 20260915',
       'สูตรของขั้น (ขั้นนี้กินอะไรเข้าไป) — ใช้ตัดของเสียให้เป็นเลข SAP'
from (values
  ('90031601', '50031601', 'MB3B-16C274-CC', 'WSS-M1A367-A36 50G50G 2.0X76.20X1600', 1::numeric, 'pcs'),
  ('90031602', '50031601', 'MB3B-16C274-CC', 'WSS-M1A367-A36 50G50G 2.0X76.20X1600', 1::numeric, 'pcs')
) as s(op_mat, mat_no, part_no, part_name, qty_per_unit, uom)
join public.dr_products p on p.mat_no = s.op_mat and coalesce(p.is_operation, false)
where not exists (
  select 1 from public.bom_items b where b.product_id = p.id and b.mat_no = s.mat_no
);

-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════════
--   select p.mat_no as op_mat, p.name, b.mat_no as consumes, b.qty_per_unit, b.uom
--     from bom_items b join dr_products p on p.id = b.product_id
--    where coalesce(p.is_operation,false) and b.is_active order by p.mat_no;
--
-- ══ Rollback (เรียงตามนี้) ══════════════════════════════════════════════════════════
--   delete from public.bom_items b using public.dr_products p
--     where b.product_id = p.id and coalesce(p.is_operation,false) and b.created_by = 'migration 20260915';
--   alter table public.scrap_report_items drop column if exists src_op_mat;
--   (โค้ดฝั่งแอปถอยได้เอง: insert ของ ScrapReport จับ 42703 แล้วบันทึกชุดเดิมต่อ)
