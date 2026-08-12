-- แยกลิสต์แจ้งซ่อมตามทีมช่างจริง — ติ๊กของเดิมเป็น JIG MTN + seed ลิสต์ของทีม MTN
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-10
--
-- ที่มา: หลัง seed ลิสต์แม่พิมพ์ (20260810_mtn_die_master_lists.sql) แล้ว user เปิดฟอร์มจริง
--   เลือกทีม DIE MTN → dropdown ยังขึ้น JIG / ROBOT ×3 / STATIONARY / CONVEYOR / NUT FEEDER อยู่ดี
--   เพราะแถวเดิม 28 ตัวยัง team = null (= 🌐 ใช้ร่วมทุกทีม) จึงติดมาในลิสต์ของทุกทีมเสมอ
--
-- ⚠️ ทำไมต้องทำ 2 ก้อนพร้อมกันในไฟล์เดียว (ห้ามรันก้อน 1 อย่างเดียว):
--   ก้อน 1 โยน JIG/ROBOT/STATIONARY/NUT FEEDER ไปเป็นของ jig_maintenance
--   → ทีม MTN (เครื่องจักร) จะเหลือ "ชนิดอุปกรณ์" แค่ CONVEYOR ตัวเดียว
--     ซึ่งเป็น required field ในฟอร์มแจ้งซ่อม = ทีม MTN แจ้งซ่อมเครื่องจักรไม่ได้เลย
--   ก้อน 2 จึงต้อง seed ลิสต์ของทีม MTN คู่กันเสมอ

-- ══ ก้อน 1: ติ๊กของเดิมเป็นของ JIG MTN ═══════════════════════
-- เกณฑ์: detail ระบุ "JIG fixture"/"Gripper" หรือชื่อบอกตรงๆ (จิ๊ก/โรบอท/นัทฟีดเดอร์/พาเลท)

update public.mtn_item_types set team = 'jig_maintenance'
where team is null and name in (
  'JIG', 'ROBOT HANDLING', 'ROBOT SPOT WELD', 'ROBOT ARC WELD', 'STATIONARY', 'NUT FEEDER'
);

update public.mtn_problem_types set team = 'jig_maintenance'
where team is null and characteristic in (
  'ปรับจิ๊กฟิกเจอร์', 'โลเคเตอร์ ชำรุด', 'แคลมป์ ชำรุด', 'สต็อปเปอร์ ชำรุด',
  'นัทฟีดเดอร์ ชำรุด', 'พาเลท ชำรุด', 'ดาตั้มซัพพอร์ต ชำรุด', 'โซลินอยด์วาวล์ ชำรุด',
  'นัทหรือโบลท์ ชำรุด', 'ปรับโรบอทเชื่อมจุด', 'ปรับโรบอทแฮนเดอร์ริ่ง',
  'ปรับโรบอทเชื่อมแก๊ส', 'แก้ไขโรบอทอะลาร์ม'
);

-- คงเป็น 🌐 ของกลางโดยตั้งใจ (เจอได้ทุกทีม — ห้ามผูกทีมใดทีมหนึ่ง):
--   ชนิดอุปกรณ์: CONVEYOR
--   ลักษณะปัญหา: เซนเซอร์ ชำรุด · กระบอกลม ชำรุด · ลมรั่ว · ระบบไฟฟ้า ชำรุด ·
--                เครื่องมาร์ค ชำรุด · ปรับ Poka-yoke · อื่นๆ

-- ══ ก้อน 2: ลิสต์ของทีม MTN (เครื่องจักร) ════════════════════
-- อิงชนิดไลน์/เครื่องที่มีจริงในระบบ: stamping · hydroform · laser · welding_assembly
--   + หมวด facility (machines.equipment_category='facility': คูลลิ่งทาวเวอร์ · เครื่องอัดลม)
-- sort_order 201+ แยกช่วงจาก DIE (101+) และของเดิม (1-99)

insert into public.mtn_item_types (name, team, sort_order)
select v.name, 'maintenance', v.ord
from (values
  ('เครื่องปั๊ม (PRESS)',            201),
  ('เครื่องไฮโดรฟอร์ม (HYDROFORM)',  202),
  ('เครื่องเลเซอร์ (LASER)',          203),
  ('เครื่องเชื่อม (WELDING)',         204),
  ('ระบบลม (AIR COMPRESSOR)',       205),
  ('ระบบน้ำ/คูลลิ่ง (COOLING)',       206),
  ('ระบบไฟฟ้า (ELECTRICAL)',        207),
  ('เครน/รอก (CRANE, HOIST)',       208),
  ('เครื่องจักรอื่นๆ',                 209)
) as v(name, ord)
where not exists (
  select 1 from public.mtn_item_types t where upper(t.name) = upper(v.name)
);

insert into public.mtn_problem_types (characteristic, detail, team, sort_order)
select v.c, v.d, 'maintenance', v.ord
from (values
  ('มอเตอร์ ชำรุด',              '(Motor-ไหม้,ร้อนจัด,ไม่หมุน,เสียงผิดปกติ)',        201),
  ('อินเวอร์เตอร์/ไดรฟ์ ผิดปกติ',   '(Inverter,Drive-อะลาร์ม,ตัดการทำงาน)',           202),
  ('ระบบไฮดรอลิก รั่ว/แรงดันตก',   '(Hydraulic-น้ำมันรั่ว,ปั๊มอ่อน,วาล์วค้าง)',        203),
  ('ระบบนิวเมติก ลมรั่ว/แรงดันตก',  '(Pneumatic-ลมรั่ว,แรงดันไม่พอ,วาล์วค้าง)',       204),
  ('แบริ่ง/ตลับลูกปืน เสียงดัง-สึก', '(Bearing-เสียงดัง,สั่น,ร้อน,สึก)',               205),
  ('สายพาน/โซ่ หย่อน-ขาด',        '(Belt,Chain-หย่อน,ขาด,สึก,หลุดร่อง)',            206),
  ('เกียร์/ชุดส่งกำลัง ผิดปกติ',     '(Gearbox-เสียงดัง,น้ำมันรั่ว,สั่น)',              207),
  ('เบรก/คลัตช์ ผิดปกติ',          '(Brake,Clutch-ลื่น,ไม่จับ,หยุดไม่ตรงจังหวะ)',     208),
  ('PLC/HMI ผิดปกติ',            '(PLC,HMI-อะลาร์ม,จอค้าง,โปรแกรมผิดพลาด)',       209),
  ('ลิมิตสวิตช์ ชำรุด',            '(Limit Switch-ไม่ตัด,ไม่ต่อ,ตำแหน่งเคลื่อน)',      210),
  ('ระบบหล่อลื่น ไม่จ่าย/รั่ว',      '(Lubrication-ปั๊มไม่จ่าย,ท่อรั่ว,หัวจ่ายตัน)',      211),
  ('ความร้อนสูงผิดปกติ',           '(Overheat-อุณหภูมิเกิน,ระบายความร้อนไม่พอ)',     212),
  ('เสียงดัง/สั่นผิดปกติ',          '(Abnormal Noise,Vibration-ต้องตรวจหาสาเหตุ)',   213)
) as v(c, d, ord)
where not exists (
  select 1 from public.mtn_problem_types t where t.characteristic = v.c
);

-- ผลลัพธ์ที่คาดหวัง (ชนิดอุปกรณ์ที่แต่ละทีมเห็น = ของทีมตัวเอง + ของกลาง):
--   DIE MTN : DIE ×5 + CONVEYOR                    = 6
--   JIG MTN : JIG/ROBOT×3/STATIONARY/NUT + CONVEYOR = 7  (เท่าเดิมเป๊ะ ไม่มีอะไรหาย)
--   MTN     : เครื่องจักร ×9 + CONVEYOR             = 10
--
-- Rollback:
--   update public.mtn_item_types    set team = null where team = 'jig_maintenance';
--   update public.mtn_problem_types set team = null where team = 'jig_maintenance';
--   delete from public.mtn_item_types    where team = 'maintenance' and sort_order between 201 and 209;
--   delete from public.mtn_problem_types where team = 'maintenance' and sort_order between 201 and 213;
--   ⚠️ 2 บรรทัดแรกล้าง jig_maintenance ทั้งหมด — ถ้ามีการติ๊กเพิ่มผ่าน UI หลังจากนี้จะโดนล้างด้วย
