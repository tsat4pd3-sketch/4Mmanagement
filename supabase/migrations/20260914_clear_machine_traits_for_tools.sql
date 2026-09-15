/* ═══════════════════════════════════════════════════════════════════════════
   ล้าง automation_level / operation_mode / gang_count ของ "ทูล" (แม่พิมพ์+จิ๊ก)
   (DR project — eyhclzkifitbhbljgoav "Product DB")                2026-09-14

   คำสั่ง user: "ล้างเลย แม่พิมพ์เป็น tool ตัวนึงที่จะต้องไปใส่กับเครื่องปั๊มเฉยๆ"

   ที่มา: ฟอร์ม MachineDatabase เดิมให้ตั้ง 2 แกนนี้กับทุกอย่างที่อยู่ "หมวดไลน์ผลิต"
   โดยไม่ดูชนิดอุปกรณ์ ⇒ แม่พิมพ์ 254 จาก 266 ตัว (+ จิ๊ก 56) ถูกติด manual/standalone ค้างไว้
   แล้ว FactoryMap เอาไปนับ "ไลน์ที่คนโหลดเข้า-ออกเอง" (ใช้จำกัดจำนวนเครื่องที่เดินได้ตามกำลังคน)
   ⇒ LINE A/B/C (ไลน์ปั๊ม) ถูกตีเป็นไลน์มือ ทั้งที่เครื่องจริงเป็น auto ล้วน
      A: manual 59/auto 12 → จริง 0/12 · B: 108/11 → 0/10 · C: 49/4 → 0/4

   แก้ที่โค้ดไปแล้ว (ฟอร์มซ่อนช่องตามชนิด + FactoryMap กรอง equipment_kind='machine')
   ไฟล์นี้ล้างค่าที่ค้างอยู่ให้หมด เพื่อไม่ให้ readers ตัวใหม่ในอนาคตหลงนับซ้ำรอยเดิม

   ⚠️ ค่าที่ล้างเป็น "ค่า default ที่ฟอร์มใส่ให้" ไม่ใช่ข้อมูลที่หน้างานตั้งใจกรอก
      (แม่พิมพ์ไม่มีระดับอัตโนมัติ/โหมดทำงานของตัวเอง — มันคือทูลที่ขึ้นไปบนเครื่องปั๊ม)
   ย้อนกลับ: ไม่ต้องย้อน — ไม่มีจอไหนอ่าน 2 คอลัมน์นี้ของแม่พิมพ์/จิ๊กแล้ว
   ═══════════════════════════════════════════════════════════════════════════ */

update machines
   set automation_level = null,
       operation_mode   = null,
       gang_count       = null,
       updated_at       = now()
 where equipment_kind in ('die', 'jig')
   and (automation_level is not null or operation_mode is not null or gang_count is not null);

-- เช็คผล (ควรได้ 0 ทั้ง 3 คอลัมน์)
-- select equipment_kind, count(automation_level) a, count(operation_mode) o, count(gang_count) g
--   from machines where equipment_kind in ('die','jig') group by 1;
