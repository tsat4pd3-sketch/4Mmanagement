-- ═══════════════════════════════════════════════════════════════════════════════
-- machines.stops_whole_line — "ของกลางของสาย: หยุดแล้วหยุดทั้งไลน์ที่ใช้มัน"
-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-28 · คำสั่ง user
--
-- ที่มา: user ชี้ว่าคอนเวเยอร์ของสาย HYDROFORM **ไม่ได้อยู่ใต้ไลน์ใดไลน์หนึ่ง** —
--   *"conveyor อยู่ไลน์แม่ เป็นเหมือนส่วนกลางที่ใช้ทั้ง hdf1, hdf2, laser345, laser789"*
--
-- ทำไมเลข `affects_lanes` อย่างเดียวไม่พอ:
--   อุปกรณ์ตัวเดียวถูกใช้โดยหลายไลน์ที่มีจำนวนเลนไม่เท่ากัน (HDF1 = 1 เลน ·
--   LASER-345 = 3 เลน) ⇒ "กระทบกี่เลน" ไม่มีคำตอบเป็นเลขเดียว · คนกรอกจะไม่รู้ว่า
--   ต้องกรอกเลขของไลน์ไหน · ธงนี้แปลว่า "ทุกเลนของไลน์ที่ใบ downtime ใบนั้นอ้างถึง"
--
-- ความหมาย (ตัวอ่าน: src/utils/affectsLanes.js → laneWeightFn ใน src/utils/oee.js):
--   true  = ของกลางของสาย → ไม่หารเลน (นาทีเต็มเข้าไลน์นั้น)
--   false/null = พฤติกรรมเดิม → `affects_lanes` ตัดสิน (ว่าง = 1 เลน)
--
-- ย้อนกลับ: alter table public.machines drop column stops_whole_line;
-- (คอลัมน์เพิ่มอย่างเดียว ไม่มี default ⇒ ของเดิมทั้งหมดเป็น null = พฤติกรรมเดิมเป๊ะ)
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.machines add column if not exists stops_whole_line boolean;

comment on column public.machines.stops_whole_line is
  'ของกลางของสาย — หยุดแล้วหยุดทุกเลนของไลน์ที่ใช้มัน (คอนเวเยอร์/ระบบลม/ตู้ไฟที่ลงทะเบียนไว้ที่ไลน์แม่). '
  'true = ไม่หารเลนในสูตร OEE. null/false = ใช้ affects_lanes ตามเดิม. อ่านผ่าน src/utils/affectsLanes.js เท่านั้น';
