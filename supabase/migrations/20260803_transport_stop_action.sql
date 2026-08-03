-- บทบาทจุดจอดต่อรอบส่ง: 'load' (รับของขึ้นรถ) / 'drop' (ส่งของลง) — แยกให้ชัดใน route + ใช้คิด load ต่อช่วงในอนาคต
-- null = derive จากชนิดจุด (dock/ท่าโหลด = load · stop/จุดส่ง = drop)
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive
-- ตั้งค่า: /transport แท็บเส้นทางรอบส่ง — คลิกป้าย ⬆/⬇ หน้าจุดจอดเพื่อสลับ

alter table transport_round_stops add column if not exists action text;

-- Rollback: alter table transport_round_stops drop column if exists action;
