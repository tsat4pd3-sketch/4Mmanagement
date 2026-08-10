-- ⚠️ ไฟล์อ้างอิง — ยังไม่ apply · รอ user ตัดสินใจก่อน (จึงไม่อยู่ใน supabase/migrations/)
-- Project: DR (eyhclzkifitbhbljgoav) · เตรียมไว้ 2026-08-10
--
-- ที่มา: หลัง seed ลิสต์แม่พิมพ์ (20260810_mtn_die_master_lists.sql) แล้ว
--        ทีม DIE MTN ยัง "ต้องเลื่อนผ่านของทีมอื่น" อยู่ดี เพราะแถวเดิม 28 ตัว
--        ยังเป็น team = null (= ใช้ร่วมทุกทีม) จึงติดมาในลิสต์ของทุกทีม
--        → ลิสต์ที่ DIE MTN เห็น = ของเดิม 28 + ของแม่พิมพ์ 27 = 55 ตัว
--
-- ⚠️ ทำไมไม่ทำใน migration เลย:
--    การติ๊กว่าแถวไหนเป็นของทีมไหน = "จัดข้อมูล" ที่กระทบทีม JIG/MTN ที่ใช้งานอยู่จริง
--    (ติ๊กผิด = ของหายจากลิสต์ของเขาโดยไม่มีใครสั่ง) — CLAUDE.md/20260806 ระบุว่าห้ามเดาให้ใน migration
--    ให้ user ตรวจรายตัวก่อน แล้วค่อยรัน (หรือติ๊กเองทีละแถวที่ /mtn-repair → ⚙️ ข้อมูลตั้งต้น)
--
-- ── กลุ่ม A: ชัดเจนว่าเป็นงาน JIG/ROBOT (detail ระบุ "JIG fixture"/"Gripper" หรือชื่อบอกตรงๆ)

update public.mtn_item_types set team = 'jig_maintenance'
where team is null and name in (
  'JIG', 'ROBOT HANDLING', 'ROBOT SPOT WELD', 'ROBOT ARC WELD', 'STATIONARY', 'NUT FEEDER'
);

update public.mtn_problem_types set team = 'jig_maintenance'
where team is null and characteristic in (
  'ปรับจิ๊กฟิกเจอร์',
  'โลเคเตอร์ ชำรุด',
  'แคลมป์ ชำรุด',
  'สต็อปเปอร์ ชำรุด',
  'นัทฟีดเดอร์ ชำรุด',
  'พาเลท ชำรุด',
  'ดาตั้มซัพพอร์ต ชำรุด',
  'โซลินอยด์วาวล์ ชำรุด',
  'นัทหรือโบลท์ ชำรุด',
  'ปรับโรบอทเชื่อมจุด',
  'ปรับโรบอทแฮนเดอร์ริ่ง',
  'ปรับโรบอทเชื่อมแก๊ส',
  'แก้ไขโรบอทอะลาร์ม'
);

-- ── กลุ่ม B: ยังไม่ชัด — ตั้งใจ "ไม่แตะ" ปล่อยเป็น common (ทุกทีมเห็น)
--   ชนิดอุปกรณ์: CONVEYOR                       (งานเครื่องกลทั่วไป อาจเป็นของ MTN)
--   ลักษณะปัญหา: เซนเซอร์ ชำรุด · กระบอกลม ชำรุด · ลมรั่ว ·
--                ระบบไฟฟ้า ชำรุด · เครื่องมาร์ค ชำรุด · ปรับ Poka-yoke · อื่นๆ
--   → พวกนี้เจอได้ทุกทีม ถ้าจะแยกต้องให้หน้างานตัดสิน ไม่ใช่เดาจากชื่อ
--
-- Rollback (คืนทุกแถวเป็น common):
--   update public.mtn_item_types    set team = null where team = 'jig_maintenance';
--   update public.mtn_problem_types set team = null where team = 'jig_maintenance';
--   ⚠️ อย่ารัน rollback นี้ถ้ามีการติ๊กทีมเพิ่มผ่าน UI ไปแล้ว — จะล้างของที่คนตั้งเองด้วย
