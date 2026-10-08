-- DR "Product DB" (eyhclzkifitbhbljgoav) · 2026-10-08 · คำสั่ง user "ผูก GPHYD05 กับจิ๊กตัวจริงให้เลย"
-- แถวทะเบียน PM (jigs) ของ GPHYD05-01/02 ไม่ได้ผูก machine_id กับจิ๊กตัวจริงใน machines (kind=jig)
-- ⇒ หน้าพิมพ์ป้ายนับเป็นตัวซ้ำ · ทำให้ตรงกับ GPHYD05-03/04 ที่ผูกไว้แล้ว (แถว PM = เงาของ machines)
-- checklists.equipment_id ยังชี้ jigs.id เดิม (ไม่แตะ) · ป้าย ESM:J เดิมยังสแกนได้ (resolveJig เทียบ id)
-- ผูกเฉพาะเมื่อยังว่างอยู่ (idempotent)
update public.jigs set machine_id = '0def1eff-219b-46bd-a6f6-9b521ea5dac2'
 where id = '71d2a598-c885-4186-b144-05de79289798' and machine_id is null and jig_no = 'GPHYD05-01';
update public.jigs set machine_id = '0e965355-010c-4dfb-9ed7-5e5f66217f5d'
 where id = '39ccc305-5caf-438c-8cae-57352a35e74a' and machine_id is null and jig_no = 'GPHYD05-02';
-- rollback:
-- update public.jigs set machine_id = null where id in ('71d2a598-c885-4186-b144-05de79289798','39ccc305-5caf-438c-8cae-57352a35e74a');
