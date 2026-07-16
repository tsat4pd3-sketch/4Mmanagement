-- 2026-07-15 · DR project (eyhclzkifitbhbljgoav)
-- Cleanup: กะที่ "ไม่มีการผลิต" (produced=0) ตอนปิดกะเก็บ oee_a=0 / oee_q=100 ค้างไว้
-- ทั้งที่ oee/oee_p เป็น null อยู่แล้ว (P คำนวณไม่ได้เพราะไม่มีผลผลิต) — เลข 0/100 พวกนี้
-- รั่วเข้า average %A/%Q ในกราฟเทรนด์ (ซึ่งกรองแค่ != null ไม่กรอง 0) ทำให้เส้นเพี้ยน
--
-- แก้ให้สอดคล้อง: กะที่ oee เป็น null และ A=0 (= ไม่มี run เลย) ให้ oee_a/oee_q เป็น null ด้วย
-- → กะนั้นกลายเป็น "ไม่มี OEE" ครบทุกช่อง ถูกกันออกจากทุก average เหมือน oee ที่ null อยู่แล้ว
-- ปลอดภัย/idempotent: predicate เจาะเฉพาะแถวที่ยังค้าง (รันซ้ำไม่กระทบแถวที่แก้ไปแล้ว)
-- ไม่แตะกะที่ผลิตจริง (oee_a<>0) และไม่แตะกะที่คำนวณ OEE ได้ (oee is not null)

update production_sessions
set oee_a = null,
    oee_q = null
where status = 'closed'
  and oee is null
  and oee_a = 0;
