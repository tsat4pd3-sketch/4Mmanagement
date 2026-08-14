-- แถวเงาใน `jigs` ต้องสะท้อนชนิดของเครื่องที่มันเป็นเงา — DR project (2026-08-10)
--
-- ⚠️ `jigs` ไม่ใช่ "ตารางจิ๊ก" — เป็นทะเบียน "อุปกรณ์ที่มีแผน PM" (ชื่อตารางหลอกตา)
--   เครื่องจักรที่ถูกวางบนผัง PM จะมี "แถวเงา" ที่นี่ (`machine_id` ชี้กลับ machines)
--
-- ปัญหา: แถวเงาตั้ง `equipment_type` อิสระจากเครื่องจริง → ข้อเท็จจริงเดียวกันอยู่ 2 ที่แล้วเพี้ยน
--   ข้อมูลจริง: เครื่องอัดลม Atlas Copco / คูลลิ่งทาวเวอร์ LIANG CHI / แอร์บูสเตอร์ 9 ตัว
--   ถูกตั้ง equipment_type='jig' ทั้งที่เป็นเครื่องจักรในโซน facility
--   → หน้าที่กรองด้วย equipment_type (DailyPM ตัด jig/die ออก · QrLabels · PMCheckData)
--     มองของพวกนี้ผิดชนิดเงียบๆ
--
-- กติกา: **machines.equipment_kind = ของจริง · jigs.equipment_type = สำเนา ห้ามตั้งอิสระ**
--   map: die→die · jig→jig · machine/facility→machine
--   (constraint `jigs_equipment_type_check` รับได้แค่ 3 ค่า — ส่วน "อยู่ในโซน facility"
--    บอกด้วย `equipment_category` ซึ่งถูกอยู่แล้ว สองแกนนี้ตัดกัน ไม่ต้องยัดรวมกัน)
--   จุดที่สร้างแถวเงา (MtnMachineLayout `placeJig`) ต้อง map แบบเดียวกันนี้เสมอ

update jigs j
set equipment_type = case m.equipment_kind
                       when 'die' then 'die'
                       when 'jig' then 'jig'
                       else 'machine'
                     end
from machines m
where j.machine_id = m.id
  and j.equipment_type is distinct from (case m.equipment_kind
                                           when 'die' then 'die'
                                           when 'jig' then 'jig'
                                           else 'machine' end);

-- ── ล้างแถวขยะจากการทดสอบ (มี guard — ลบเฉพาะที่ "ว่างจริง") ──────────────
-- ⚠️ guard ทั้ง 2 ชั้นตั้งใจให้เข้มกว่าที่คิดว่าจำเป็น: ลบทะเบียนอุปกรณ์ผิดตัว
--    = ประวัติการตรวจกำพร้า ซึ่งกู้คืนไม่ได้
-- ผลรันจริง 2026-08-10: **ไม่ถูกลบ** — แถว `1/mc1` (ไลน์ 'test child') มีจุดตรวจ 3 ข้อ
--    ที่มีคนพิมพ์ไว้จริง (ตอนแรกเข้าใจว่า checklist ว่าง) → guard ทำงานถูกต้อง
--    ถ้าจะลบต้องให้คนยืนยันว่าไลน์ 'test child' เลิกใช้แล้วจริง แล้วลบผ่านหน้า PM Setup
delete from checklists c
where c.equipment_id = (select id from jigs where jig_no='1' and name='mc1' and machine_id is null)
  and not exists (select 1 from inspections i where i.checklist_id = c.id)
  and not exists (select 1 from jig_checkpoints k where k.checklist_id = c.id);

delete from jigs
where jig_no='1' and name='mc1' and machine_id is null
  and not exists (select 1 from checklists c where c.equipment_id = jigs.id);
