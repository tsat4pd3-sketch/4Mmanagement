-- DR "Product DB" (eyhclzkifitbhbljgoav) · 2026-10-08 · คำสั่ง user "ลงทะเบียนแม่พิมพ์ BLM ให้เลย"
-- ทีมแม่พิมพ์ (toolingmaintenance) ลง (BD-06)-BLM-RH-HDF02 / (BD-03)-BLM-LH-HDF01 ไว้ที่ทะเบียน PM (jigs · equipment_type='die')
-- แต่ไม่มีแถวในทะเบียนแม่พิมพ์ (machines kind=die) ⇒ สแกนเข้าผังจัดเก็บ/ใบแจ้งซ่อมเลือกไม่ได้
-- ลงทะเบียนจากข้อมูลในแถว PM เท่านั้น (ไม่เดา):
--   · machine_no = ชื่อที่ทีมตั้ง (ตรงตัว) · line = HDF1/HDF2 · model ELECT80
--   · ผูกชุด: part_no + ข้าง + ไลน์ ตรงกับชุดที่มีอยู่ DS-MB3B-16E060-CF-HDF2 (RH) / DS-MB3B-16E061-CF-HDF1 (LH)
--   · op_name = 'BLM' ตามชื่อ · **op_type = null (ยังไม่รู้ว่า BLM คือ OP ประเภทไหน — ทีม DIE ตั้งที่ทะเบียน)**
--   · ค่าอื่น (process_type/category) ตามแม่พิมพ์ HDF ตัวอื่นในชุดเดียวกัน
-- แล้วผูกแถว PM เดิมเป็นเงา (jigs.machine_id) — checklists ไม่ขยับ · idempotent (on conflict / where null)
insert into public.machines (id, machine_no, machine_name, line_name, process_type, equipment_kind, equipment_category, is_active, sort_order, updated_by_name)
values
 ('49af2b7d-8e91-43c5-9d55-31d7df1801e6', '(BD-06)-BLM-RH-HDF02', 'ELECT80', 'HDF2', 'welding_assembly', 'die', 'production', true, 545, 'migration 20261008b (จากทะเบียน PM)'),
 ('e8b8c98f-f86d-4ad4-b12e-4d330a5370b9', '(BD-03)-BLM-LH-HDF01', 'ELECT80', 'HDF1', 'welding_assembly', 'die', 'production', true, 546, 'migration 20261008b (จากทะเบียน PM)')
on conflict (id) do nothing;

insert into public.equipment_die (machine_id, die_set_id, op_name, op_type, note, updated_by_name)
values
 ('49af2b7d-8e91-43c5-9d55-31d7df1801e6', '15270330-86ee-4e4f-a4a1-41bc3e49bde5', 'BLM', null, 'ลงทะเบียนจากทะเบียน PM 08/10 · ประเภท OP ยังไม่ระบุ', 'migration 20261008b (จากทะเบียน PM)'),
 ('e8b8c98f-f86d-4ad4-b12e-4d330a5370b9', '6d35b8f8-e475-4331-9753-adbd495cb9c0', 'BLM', null, 'ลงทะเบียนจากทะเบียน PM 08/10 · ประเภท OP ยังไม่ระบุ', 'migration 20261008b (จากทะเบียน PM)')
on conflict (machine_id) do nothing;

update public.jigs set machine_id = '49af2b7d-8e91-43c5-9d55-31d7df1801e6'
 where id = '15edf40b-1732-4a8d-9523-e1588f06312e' and machine_id is null;
update public.jigs set machine_id = 'e8b8c98f-f86d-4ad4-b12e-4d330a5370b9'
 where id = '582ff40a-496c-4a49-8e73-a220165f63a4' and machine_id is null;

-- rollback (ลำดับ: ปลดเงาก่อน แล้วลบส่วนขยาย แล้วลบตัวตน):
-- update public.jigs set machine_id = null where id in ('15edf40b-1732-4a8d-9523-e1588f06312e','582ff40a-496c-4a49-8e73-a220165f63a4');
-- delete from public.equipment_die where machine_id in ('49af2b7d-8e91-43c5-9d55-31d7df1801e6','e8b8c98f-f86d-4ad4-b12e-4d330a5370b9');
-- delete from public.machines where id in ('49af2b7d-8e91-43c5-9d55-31d7df1801e6','e8b8c98f-f86d-4ad4-b12e-4d330a5370b9');
