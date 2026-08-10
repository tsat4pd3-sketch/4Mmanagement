-- AM registry: ถอนเครื่องที่ปิดใช้งานแล้วออกจาก "ต้องตรวจทุกต้นกะ"  (DR project)
--
-- ที่มา: `machines.is_active = false` (ปลดเครื่อง) ไม่เคย propagate ไปฝั่ง PM/AM เลย
-- เพราะ `jigs` (ทะเบียนอุปกรณ์ที่มีแผน PM) ไม่มีคอลัมน์ is_active — แถวเงาของเครื่อง
-- (jigs.machine_id ชี้กลับ machines) จึงยัง "ดูมีชีวิต" ต่อไป
--   → หน้างานถูกสั่งให้ตรวจเครื่องที่ปลดไปแล้วทุกต้นกะ และไลน์ติดค้าง 🟠 ตลอดเพราะตรวจไม่ได้
-- เจอจริง 2026-08-05: BD-05 (HYDROFORM) + TEST1 (ข้อมูลทดสอบ) ยังอยู่ในทะเบียน AM
--
-- ที่นี่แก้เฉพาะ "ข้อมูลค้าง" — ฝั่งโค้ดกรองด้วย loadRetiredEquipIds() ใน src/lib/pmChecklists.js
-- ไม่ลบแถว (เก็บเป็นประวัติ) แค่ปิด is_active — เปิดเครื่องกลับมาใช้ก็ติ๊กลงทะเบียนใหม่ได้ตามปกติ

update pm_daily_line_targets t
   set is_active = false
  from jigs j
  left join machines m on m.id = j.machine_id
 where t.jig_id = j.id
   and t.is_active = true
   and j.machine_id is not null
   and (m.id is null or m.is_active = false);
