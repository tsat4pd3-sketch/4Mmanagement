-- ── DR project ──
-- หมายเหตุผู้อนุมัติปิดกะ (optional — SV กรอกตอนกดอนุมัติ "เผื่อหัวหน้ามีอะไรเพิ่มเติม จะหมายเหตุไว้"
-- คำขอ Sup Assy2 ผ่าน user 2026-07-24) · โค้ดเขียนแบบ best-effort (try/catch แยก update) —
-- ยังไม่ apply migration = อนุมัติได้ปกติ แค่ไม่เก็บหมายเหตุ · แสดงในแท็บประวัติ (expand กะ)
alter table production_sessions add column if not exists close_approve_note text;
