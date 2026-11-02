-- 👷 ตำแหน่ง "พนักงานจ้างเหมารายวัน" + เกรดชั้น Y (2026-10-21 · คำสั่ง user)
--   user: "พนักงานจ้างเหมารายวัน ตอนนี้เลือกระดับ Y ไม่ได้ เหมือนบังคับไป T6,7,8
--          ซึ่งไม่ถูก T678 คือพนักงานประจำ"
--
-- ต้นเหตุ: ทะเบียน `positions` ไม่มีตำแหน่งของคนจ้างเหมา ⇒ ต้องเลือก "พนักงานฝ่ายผลิต"
-- (operator) ที่แม่แบบ HR กำหนดเกรดไว้ T6/T7/T8 ⇒ เลือก Y1 แล้วจอขึ้นเตือนว่าไม่ตรงแม่แบบ
-- (ระบบไม่เคยบล็อก — แต่ป้ายเตือนอ่านแล้วเหมือนห้าม)
--
-- 🔴 เกรดชั้น Y ในทะเบียน `grades` มีตัวเดียว = `Y1` (พนักงานชั่วคราว)
--    ถ้าจริงๆ มี Y2/Y3 ให้เพิ่มแถวใน `grades` ก่อน แล้วค่อยเติมใน grade_codes ของตำแหน่งนี้
insert into public.positions (key, label_th, level, grade_codes, is_active, sort_order)
values ('contract_daily', 'พนักงานจ้างเหมารายวัน', 'operator', array['Y1'], true, 15)
on conflict (key) do update
  set label_th = excluded.label_th, level = excluded.level,
      grade_codes = excluded.grade_codes, is_active = true, sort_order = excluded.sort_order;
-- ROLLBACK: update public.positions set is_active = false where key = 'contract_daily';
