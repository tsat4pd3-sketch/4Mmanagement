-- ══ 🔧 ธง "ประเภท downtime นี้เป็นเครื่องเสียที่ช่างรับผิดชอบไหม" ══  2026-11-13
-- Project: DR (ชื่อในจอ Supabase = "Product DB" · eyhclzkifitbhbljgoav)
-- คำสั่ง user: *"ทำข้อ 2 ติดธงในทะเบียนประเภท downtime"*
--
-- ที่มา (วัดจริง ต.ค. 2026 · downtime นอกแผนที่ปิดแล้ว):
--   KPI ทางการนับ **ทุกแถวที่ไม่ใช่ planned** เข้า Machine Break Down / MTTR / MTBF ของทีมช่าง
--   โดยไม่สนว่าช่างเคยถูกเรียกไหม ⇒ ช่างแบกชั่วโมงที่ไม่เคยถูกเรียก 813.6 ชม. (78.8%)
--   ในก้อนนั้นมี "แก้ไขปัญหาคุณภาพ" + "แก้ไขคุณภาพระหว่างผลิต" รวม 107.6 ชม. ที่ไม่ใช่เครื่องเสียเลย
--
-- 🔴 3 สถานะ ห้ามยุบเหลือ 2 — จึงเป็น `boolean` **nullable ไม่มี default**:
--      true  = ของช่าง (เครื่องเสีย)
--      false = ไม่ใช่ของช่าง (คุณภาพ · ปรับตั้ง · รอของ)
--      null  = **ยังไม่มีใครติ๊ก ≠ ไม่ใช่ของช่าง** ⇒ ชั่วโมงอยู่ถังแยก ไม่ถูกนับให้ฝั่งไหน
-- 🔴 **ห้าม seed ค่าเดาจากชื่อประเภท** (กฎ §"อื่นๆ/ไม่ระบุ" ข้อ 5: ห้ามเดา taxonomy)
--    ชื่ออย่าง "อื่นๆ (นอกแผน)" (108 ชม. · อันดับ 1) เดาไม่ได้เลยว่าของใคร — ให้คนที่รู้งานติ๊ก
-- 🔴 ธงนี้ **ไม่แตะเลขที่ส่งกลุ่ม** — Machine Break Down / MTBF / MTTR ยังนับไลน์หยุดเต็มตาม
--    KPI Guideline เหมือนเดิม (กลุ่มเป็นเจ้าของนิยาม · ESM = ที่ผลิตตัวเลข Actual)
--
-- ย้อนกลับ: alter table public.dr_downtime_types drop column is_machine_breakdown;
--           (คอลัมน์ nullable ไม่มี default ⇒ โค้ดเก่าไม่รู้จักก็ไม่พัง · จอถอยไป "ยังไม่ระบุ")
-- เจ้าของกฎฝั่งจอ: src/utils/dtBreakdownOwner.js

alter table public.dr_downtime_types
  add column if not exists is_machine_breakdown boolean;

comment on column public.dr_downtime_types.is_machine_breakdown is
  'เวลาหยุดของประเภทนี้เป็น "เครื่องเสียที่ช่างรับผิดชอบ" ไหม — true=ของช่าง · false=ไม่ใช่ของช่าง · null=ยังไม่มีใครติ๊ก (ห้ามเดาเป็น false) · ไม่กระทบ KPI ที่ส่งกลุ่ม · อ่านผ่าน src/utils/dtBreakdownOwner.js';
