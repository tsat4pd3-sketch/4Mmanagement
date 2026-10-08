-- DR "Product DB" (eyhclzkifitbhbljgoav) · 2026-10-08 · user: "BLM คือชื่อ BRAND ของเครื่อง Bending"
-- แม่พิมพ์ BLM 2 ตัว (20261008b) = แม่พิมพ์ของเครื่อง Bending ⇒ op_type = 'bend' (→ ใบแจ้งซ่อม DIE BENDING)
-- op_name เดิมใส่ 'BLM' (เข้าใจว่าเป็นชื่อ OP) — แก้เป็น null แล้วจดยี่ห้อไว้ใน note แทน
update public.equipment_die
   set op_type = 'bend', op_name = null,
       note = 'ลงทะเบียนจากทะเบียน PM 08/10 · ใช้กับเครื่อง Bending ยี่ห้อ BLM',
       updated_by_name = 'migration 20261008c'
 where machine_id in ('49af2b7d-8e91-43c5-9d55-31d7df1801e6','e8b8c98f-f86d-4ad4-b12e-4d330a5370b9');
-- rollback: update public.equipment_die set op_type = null, op_name = 'BLM' where machine_id in ('49af2b7d-8e91-43c5-9d55-31d7df1801e6','e8b8c98f-f86d-4ad4-b12e-4d330a5370b9');
