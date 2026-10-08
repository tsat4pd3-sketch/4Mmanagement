-- ═══════════════════════════════════════════════════════════════════
-- ใบ A3 Report ของโปรเจคปรับปรุง (PDCA / DMAIC) — DR project (eyhclzkifitbhbljgoav)
--
-- คำสั่ง user 2026-09-17: "export project improvement ออกมาในรูปแบบ A3 report
--   โดยใช้หลักการ PDCA หรือ DMAIC"
--
-- ใบ A3 ส่วนใหญ่ประกอบจากข้อมูลที่ระบบมีอยู่แล้ว (ปัญหา · baseline · เป้าหมาย · แผนงาน
--   milestone · ผลก่อน/หลัง · cost saving · คำขอแก้เอกสาร PE) — คอลัมน์นี้เก็บเฉพาะ
--   "สิ่งที่ระบบไม่มีทางรู้" ซึ่งคนต้องเขียนเอง:
--     framework        กรอบการเล่าเรื่องของใบ ('pdca' | 'dmaic')
--     background       ความเป็นมา/ทำไมต้องทำเรื่องนี้
--     root_cause       วิเคราะห์สาเหตุราก (5 Why / ก้างปลา) — ระบบรู้ว่า "เกิดอะไร" ไม่รู้ "ทำไม"
--     countermeasures  รายละเอียดมาตรการ (เพิ่มจากช่อง action_taken เดิม)
--     standardize      มาตรฐาน & ขยายผล (yokoten)
--     team             ทีมงานที่แสดงบนหัวใบ
--
-- ทำไมเป็น jsonb ก้อนเดียว ไม่ใช่ 6 คอลัมน์: เป็น "เนื้อความของใบพิมพ์" ที่ไม่มีใคร query/รวมยอด
--   (pattern เดียวกับ vsm_maps.data.a3) — เพิ่มช่องใหม่ในใบ = ไม่ต้อง migration อีก
--
-- ⚠️ เก็บ phase ของแผนงานเป็น PDCA เหมือนเดิมเสมอ (improvement_milestones.phase)
--    โหมด DMAIC คือ "การแสดงเทียบ" บนใบพิมพ์เท่านั้น — ห้ามเขียนค่า define/measure/... ลง DB
--    ไม่งั้นแผนงานจะมีมาตรฐานปนกัน 2 ชุดในตารางเดียว แล้ว filter/สรุปพัง
--
-- RLS: anon-open ตาม convention ฝั่ง DR (client supabaseDR ไม่มี JWT) — policy เดิมของตารางครอบให้แล้ว
-- additive ล้วน · โค้ดฝั่งเว็บ tolerant: ไม่มีคอลัมน์ = พิมพ์ใบได้ปกติ แค่บันทึกข้อความไม่ได้ + ขึ้น toast บอก
-- ═══════════════════════════════════════════════════════════════════

alter table improvements add column if not exists a3 jsonb;

comment on column improvements.a3 is
  'เนื้อหาใบ A3 Report ที่คนเขียนเอง: {framework: pdca|dmaic, background, root_cause, countermeasures, standardize, team} — ตัวเลข/ผล/เงินบนใบไม่เก็บที่นี่ คำนวณสดจากข้อมูลจริงทุกครั้งที่พิมพ์';

-- Rollback:
--   alter table improvements drop column if exists a3;
--   (โค้ดฝั่งเว็บถอยเองได้ — a3 undefined = ใบ A3 ออกได้ แค่ช่องที่คนเขียนว่างและมีข้อความบอกว่าไปกรอกที่ไหน)
