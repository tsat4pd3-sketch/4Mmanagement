-- ความจุยานพาหนะ (กล่อง/kanban ต่อเที่ยว) — ใช้คำนวณ load รอบส่ง: การ์ด N ใบ ÷ ความจุ = กี่เที่ยว
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive, ไม่กระทบของเดิม
-- ตั้งค่าที่ /transport แท็บเส้นทางรอบส่ง (ช่อง "จุ ... กล่อง/เที่ยว" ข้างความเร็ว)
-- แสดงผลที่ Heijunka Kanban → ⏰ รอบจัดส่งวันนี้ (🚚 M เที่ยว ต่อรอบ)

alter table transport_vehicles add column if not exists capacity_pkg numeric;

-- Rollback: alter table transport_vehicles drop column if exists capacity_pkg;
