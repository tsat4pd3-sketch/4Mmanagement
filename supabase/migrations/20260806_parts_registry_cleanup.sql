-- ═══════════════════════════════════════════════════════════════════════════
-- Parts Master = ทะเบียนกลาง (material master) — data cleanup รอบแรก (2026-08-06)
-- DR project (eyhclzkifitbhbljgoav)
--
-- โมเดลที่ตกลงกับ user: parts_master เป็นทะเบียนตัวตนของทุก mat (1/2/3/5)
-- dr_products = มุมมองการผลิต · kanban_standards = มุมมองการดึง · bom = โครงสร้าง
-- "ชื่อสินค้า" parts_master เป็นเจ้าของที่เดียว (ชื่อฝั่งนั้นละเอียดกว่า มีเลขลูกค้ากำกับ)
--
-- ทำ 2 อย่าง:
-- 1) ลบ product ทดสอบ 100999 / 2000999 (ตรวจแล้ว: 0 ใบผลิต 0 กะ 0 สต๊อก —
--    มีแค่ bom_items 2 แถว + kanban_standards 1 แถวต่อตัว ซึ่งเป็นข้อมูลทดสอบตาม)
--    * เลขชั่วคราว SUB APRON (M6/M8/127/E024/"300xxx & 300xxx") และ 90031601/2
--      ยังถูกใช้จริง (มีใบผลิต/สต๊อก/forecast) — ห้ามลบ รอเลข SAP จริงมา "เปลี่ยนเลข" แทน
-- 2) sync ชื่อ dr_products ให้ตรง parts_master (21 ตัวที่ mat ตรงกันแต่ชื่อ drift)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) ลบข้อมูลทดสอบ — guard ซ้ำในตัว: แตะเฉพาะแถวที่ไม่มีใบผลิต/กะอ้างถึงจริง
do $$
declare
  tp record;
begin
  for tp in
    select id, mat_no from dr_products
    where mat_no in ('100999', '2000999')
      and not exists (select 1 from prod_orders o where o.mat_no = dr_products.mat_no)
      and not exists (select 1 from production_sessions s where s.product_id = dr_products.id)
  loop
    delete from bom_items where product_id = tp.id;
    delete from kanban_standards where product_id = tp.id or mat_no = tp.mat_no;
    delete from dr_products where id = tp.id;
    raise notice 'deleted test product % (%)', tp.mat_no, tp.id;
  end loop;
end $$;

-- 2) sync ชื่อจากทะเบียนกลาง (parts_master ชนะ) — idempotent แตะเฉพาะแถวที่ชื่อต่างจริง
update dr_products dp
set name = pm.part_name
from parts_master pm
where dp.mat_no = pm.mat_no
  and btrim(coalesce(pm.part_name, '')) <> ''
  and btrim(coalesce(dp.name, '')) <> btrim(pm.part_name);
