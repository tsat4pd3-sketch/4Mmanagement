-- ⏰ Seed รอบจัดส่งสโตร์ → ไลน์ผลิต 3 รอบ/วัน ทุกไลน์ผลิต  (DR)
--
-- ที่มา (user 2026-08-26): "seed ให้ทีได้มั้ย รอบ 10:00 13:00 16:00 มีสามรอบต่อวัน และ seed ทุกไลน์ผลิต"
--   ก่อนหน้านี้ทั้งระบบมี `kanban_delivery_rounds` แค่ **2 รอบ** (HYDROFORM + LINE APRON ASSY กะเช้า 11:00)
--   ขณะที่ฝั่งลูกค้ามี 62 รอบ/วัน เพราะ EDI ป้อนให้เอง
--   ⇒ นั่นคือเหตุผลจริงที่ Store Time Chart / Store Board "ดูไม่ออก" — ไม่มีเวลาให้ยึด ก็ไม่มีอะไรวาดบนแกนเวลา
--
-- ⚠️ ระดับที่ seed = **ไลน์บนสุด (parent_line_name IS NULL) เท่านั้น**
--   เพราะทั้ง `roundsByGroup` (จัดสรร NET ต่อรอบ) และ `byLine` (แถวบนชาร์ต) จัดกลุ่มด้วย
--   `groupOf(line) = parent_line_name || line` — seed ที่ไลน์ลูกด้วยจะกลายเป็น 6 รอบต่อกลุ่ม
--   ตรงกับ 2 แถวเดิมที่มีอยู่ (HYDROFORM / LINE APRON ASSY ก็เป็นไลน์บนสุดทั้งคู่)
--
-- ⚠️ ชื่อไลน์ hardcode เพราะ `production_lines` อยู่ Main แต่ตารางนี้อยู่ DR (join ข้าม project ไม่ได้)
--   เปลี่ยนชื่อไลน์ภายหลังไม่ต้องมาแก้ไฟล์นี้ — `handleRenameLine` (LineSetup) cascade
--   `kanban_delivery_rounds` ให้อยู่แล้ว
--
-- ⚠️ ไม่ seed 2 ตัวนี้ (ไม่ใช่ไลน์ผลิตที่กินพาร์ทตาม BOM) — ถ้าต้องการให้เพิ่มเองที่ 📦 Line Stock → ⏰ รอบจัดส่ง
--     • `Rework - PD1`  = สถานีแก้งาน
--     • `test`          = ไลน์ทดสอบ (section TEST)
--
-- ⚠️ **กะดึกยังไม่ได้ seed** — 10:00/13:00/16:00 เป็นเวลากะเช้าทั้งหมด
--    ข้อมูลจริง 30 วัน: กะดึก 240 กะ / 14 ไลน์ (มากกว่ากะเช้า 226 กะ / 16 ไลน์)
--    ⇒ ยังมีความต้องการอีกครึ่งที่ไม่มีรอบรองรับ · **ไม่เดาเวลาให้** เป็นการตัดสินใจหน้างาน
--    เติมทีหลังได้โดยรันบล็อกเดียวกันแล้วเปลี่ยน 'day' → 'night' + เวลาที่ต้องการ
--
-- cutoff = เวลาส่ง − 60 นาที (ธรรมเนียมเดิมของ 2 แถวที่มีอยู่: ตัดยอด 10:00 → ส่ง 11:00)
-- on conflict อัปเดต "เฉพาะเวลา" — คงค่า prep_minutes / points_count / time_per_point_min / note ของเดิมไว้
--   (HYDROFORM รอบ 1 ตั้ง points_count = 2 จุดจริง ห้ามทับด้วย default)

insert into public.kanban_delivery_rounds
  (line_name, shift, round_no, cutoff_time, delivery_time, prep_minutes, points_count, time_per_point_min, created_by, note)
select l.line_name, 'day', r.round_no, r.cutoff_time, r.delivery_time, 60, 1, 10, 'seed 2026-08-26', 'seed 3 รอบ/วัน'
from (values
  ('GOR'), ('HYDROFORM'), ('LINE A ( 800 Ton )'), ('LINE APRON ASSY'),
  ('LINE ASSY FORD UP375'), ('LINE ASSY TSRA'), ('LINE B ( 600 Ton )'),
  ('LINE C ( 200&250 Ton )'), ('LINE D ( 110&300 Ton )'), ('LWR BAR')
) as l(line_name)
cross join (values
  (1, time '09:00', time '10:00'),
  (2, time '12:00', time '13:00'),
  (3, time '15:00', time '16:00')
) as r(round_no, cutoff_time, delivery_time)
on conflict (line_name, shift, round_no) do update
  set cutoff_time   = excluded.cutoff_time,
      delivery_time = excluded.delivery_time,
      is_active     = true;

-- ตรวจผล:
--   select line_name, shift, round_no, cutoff_time, delivery_time, points_count
--     from kanban_delivery_rounds where is_active order by line_name, shift, round_no;
--   → ควรได้ 30 แถว (10 ไลน์ × 3 รอบ) กะเช้าทั้งหมด
--
-- Rollback (กลับไปสภาพเดิม 2 แถว):
--   delete from kanban_delivery_rounds where created_by = 'seed 2026-08-26';
--   update kanban_delivery_rounds set cutoff_time = '10:00', delivery_time = '11:00'
--    where (line_name, shift, round_no) in (('HYDROFORM','day',1), ('LINE APRON ASSY','day',2));
--   ⚠️ 2 แถวเดิมถูก "อัปเดตเวลา" ไม่ได้ถูกสร้างใหม่ จึงไม่ติด created_by ของ seed — ต้องคืนค่าเอง
