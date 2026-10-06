-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ชนิดอุปกรณ์ในใบแจ้งซ่อม ตาม "ประเภท OP" ของแม่พิมพ์ — 2026-10-06 · คอมเมนต์ทีม DIE (MO_ESM_Website.pptx)
--
-- ที่มา: ไลน์ HDF01/02 ขอชนิด "DIE HYDRO / DIE BENDING / DIE PREFORM" — แต่ HDF 1 พาร์ท = ชุด Single 1 ชุด
--   มีแม่พิมพ์ 3 ตัว (HYDRO/BENDING/PREFORM) ⇒ ชนิดเป็นคุณสมบัติของ "แม่พิมพ์รายตัว" ไม่ใช่ของ "ชุด"
--   แกนนี้มีอยู่แล้ว = equipment_die.op_type → die_op_types (hydro/bend/preform มีครบ)
--   ⇒ เพิ่ม die_op_types.mo_item_type · ใบแจ้งซ่อมใช้ "ประเภท OP ก่อน · ไม่มีค่อยใช้รูปแบบชุด"
-- ทุกรายการเป็นทะเบียนที่ทีมเพิ่ม/ลบ/แก้เองได้ (ไม่ hardcode): mtn_item_types · die_op_types · die_set_kinds
--
-- apply แล้ว 06/10 โดย AI session ผ่าน MCP (ทีละคำสั่ง — apply_migration timeout)
-- rollback (revert โค้ดก่อน): alter table die_op_types drop column mo_item_type;
--   update equipment_die set op_type=null where updated_by_name='migration 20261006 (จากชื่อแม่พิมพ์)';
--   ชนิดอุปกรณ์ที่เปลี่ยนชื่อ/เพิ่ม: ดู updated_by_name='migration 20261006' ใน mtn_item_types

alter table public.die_op_types add column if not exists mo_item_type text;
comment on column public.die_op_types.mo_item_type is
  'ชื่อใน mtn_item_types ที่ใบแจ้งซ่อมเติมให้เมื่อเลือกแม่พิมพ์ที่มีประเภท OP นี้ (ชนะรูปแบบชุด) · null = ใช้ของรูปแบบชุด';

-- ชื่อให้ตรงคำที่ทีมขอ (2 แถวนี้เพิ่งสร้างเมื่อ 05/10 · ยังไม่มีใบไหนใช้ = 0 ใบ)
update public.mtn_item_types set name = 'DIE HYDRO',   updated_by_name = 'migration 20261006'
 where name = 'DIE HYDROFORM' and updated_by_name = 'migration 20261005';
update public.mtn_item_types set name = 'DIE BENDING', updated_by_name = 'migration 20261006'
 where name = 'DIE BEND' and updated_by_name = 'migration 20261005';
insert into public.mtn_item_types (name, team, sort_order, is_active, updated_by_name)
select 'DIE PREFORM', 'die_maintenance', 108, true, 'migration 20261006'
 where not exists (select 1 from public.mtn_item_types where upper(btrim(name)) = 'DIE PREFORM');

update public.die_op_types set mo_item_type = case key
  when 'hydro' then 'DIE HYDRO' when 'bend' then 'DIE BENDING' when 'preform' then 'DIE PREFORM' end
 where key in ('hydro','bend','preform') and mo_item_type is null;
update public.die_set_kinds set mo_item_type = case key when 'hydroform' then 'DIE HYDRO' when 'bend' then 'DIE BENDING' end
 where key in ('hydroform','bend');

-- แม่พิมพ์ HDF 12 ตัว: ชื่อลงท้ายด้วย HYDRO1/BENDING2/PREFORM1 ชัดเจน (ไม่ใช่การเดา) — แตะเฉพาะที่ op_type ยังว่าง
update public.equipment_die ed set
  op_type = case when m.machine_no ~ 'HYDRO[0-9]+$' then 'hydro'
                 when m.machine_no ~ 'BENDING[0-9]+$' then 'bend'
                 when m.machine_no ~ 'PREFORM[0-9]+$' then 'preform' end,
  updated_by_name = 'migration 20261006 (จากชื่อแม่พิมพ์)'
from public.machines m
where m.id = ed.machine_id and m.line_name in ('HDF1','HDF2') and ed.op_type is null
  and m.machine_no ~ '(HYDRO|BENDING|PREFORM)[0-9]+$';
