-- ═══ เก็บ typo ชนิดอุปกรณ์ทีม MTN: "' เครื่องปั๊ม (PRESS)" → "เครื่องปั๊ม (PRESS)" (2026-08-17) ═══
-- โปรเจค: DR (eyhclzkifitbhbljgoav)
-- แถว seed ทีม MTN ติด apostrophe + ช่องว่างนำหน้า (จากการ copy) — โชว์ในฟอร์มแจ้งซ่อมตามนั้น
-- กฎ NAME_CASCADE: ใบซ่อมเก็บ item_type เป็นข้อความ snapshot → เปลี่ยนชื่อ master ต้อง cascade
--   ให้ใบเก่าตามไปด้วย (deterministic — ตัดอักขระขยะหน้าชื่อ ไม่เปลี่ยนความหมาย) กัน KPI แตกกลุ่ม

update mtn_item_types
set name = 'เครื่องปั๊ม (PRESS)'
where name <> 'เครื่องปั๊ม (PRESS)' and name like '%เครื่องปั๊ม (PRESS)';

update mtn_orders
set item_type = 'เครื่องปั๊ม (PRESS)'
where item_type <> 'เครื่องปั๊ม (PRESS)' and item_type like '%เครื่องปั๊ม (PRESS)';
