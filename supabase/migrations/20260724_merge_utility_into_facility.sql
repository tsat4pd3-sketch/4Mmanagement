-- รวมหมวด Utility เข้ากับ Facility (ทีมช่างดูแลทีมเดียวกัน + แยกยาก · คำสั่ง user 2026-07-24) — DR project
-- คงค่าหมวดเหลือ 2 แบบ: 'production' / 'facility' · 'utility' เดิม → 'facility'
-- โค้ดที่เหลือเช็ค equipment_category != 'production' (facility+utility รวมกันอยู่แล้ว) จึงไม่กระทบ
update public.machines set equipment_category = 'facility' where equipment_category = 'utility';
-- shadow jig ของ facility/utility (module='mtn') ที่ carry ค่ามาจากเครื่อง
update public.jigs set equipment_category = 'facility' where equipment_category = 'utility';
