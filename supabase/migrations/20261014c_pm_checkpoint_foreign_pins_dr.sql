-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-14 · user อนุมัติ "ล้างตำแหน่งหมุดให้ช่างไปปักใหม่"
-- 📍 ล้างหมุดจุดตรวจ PM ที่ผูกกับ "รูปของเครื่องอื่น" (ผลข้างเคียงของการคัดลอกจุดตรวจข้ามเครื่องแบบเดิม)
--
-- อาการ: คัดลอกจุดตรวจไปเครื่องอื่นเดิมก๊อป x_pos/y_pos/label_dx/label_dy/image_id + jig_id ของต้นทางไปด้วย
--   ⇒ จอตั้งค่า: หมุดไปโผล่บนรูปแรกของเครื่องใหม่ ตรงตำแหน่งที่ไม่มีความหมาย
--   ⇒ จอตรวจ (PMCheckData): หาเฟรม image_id ไม่เจอ = หมุดหายไปเลย
--   โค้ดแก้แล้วในคอมมิทเดียวกัน (`src/utils/pmCheckpointCopy.js` · ข้ามเครื่อง = ล้างหมุด + jig_id = ปลายทาง)
--
-- ยอดก่อนรัน (14/10): 9 จุด บน 1 เครื่อง (RB-121 - ABB IRB1520 · แผนก maintenance) · ผลตรวจที่ผูกอยู่ = 0
-- เลือกแถวด้วยเงื่อนไข "เฟรมของหมุดเป็นของเครื่องอื่น" (ไม่ hardcode id) — นิยาม/ชื่อ/เกณฑ์/รูปโคลสอัพของจุดไม่แตะ
-- Blast radius: 5 คอลัมน์หมุด + jig_id ของ 9 แถวใน jig_checkpoints · ไม่แตะ inspection_results

create schema if not exists archive;

create table if not exists archive.jig_cp_foreign_pins_20261014 as
  select cp.id, cp.jig_id, cp.x_pos, cp.y_pos, cp.label_dx, cp.label_dy, cp.image_id
    from public.jig_checkpoints cp
    join public.checklists cl on cl.id = cp.checklist_id
    join public.jig_images ji on ji.id = cp.image_id
   where ji.jig_id <> cl.equipment_id;
alter table archive.jig_cp_foreign_pins_20261014 enable row level security;

update public.jig_checkpoints cp
   set x_pos = null, y_pos = null, label_dx = null, label_dy = null, image_id = null,
       jig_id = cl.equipment_id
  from public.checklists cl, archive.jig_cp_foreign_pins_20261014 a
 where a.id = cp.id and cl.id = cp.checklist_id;

-- ══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════════
--   select count(*) from archive.jig_cp_foreign_pins_20261014;                    -- 9
--   select count(*) from jig_checkpoints cp join checklists cl on cl.id = cp.checklist_id
--     join jig_images ji on ji.id = cp.image_id where ji.jig_id <> cl.equipment_id; -- 0
--   select count(*) from jig_checkpoints cp join checklists cl on cl.id = cp.checklist_id
--    where cp.jig_id is distinct from cl.equipment_id;                             -- 0
--
-- ══ ย้อน ═════════════════════════════════════════════════════════════════════════
--   update public.jig_checkpoints cp
--      set jig_id = a.jig_id, x_pos = a.x_pos, y_pos = a.y_pos,
--          label_dx = a.label_dx, label_dy = a.label_dy, image_id = a.image_id
--     from archive.jig_cp_foreign_pins_20261014 a where a.id = cp.id;
