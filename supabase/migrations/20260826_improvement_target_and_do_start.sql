-- โปรเจคปรับปรุง: แยก "เป้าหมาย" ออกจาก "ผลจริง" + ยืนยันวันเริ่มลงมือแก้  (DR project)
--
-- ปัญหาที่เจอจากหน้าจอจริง (2026-08-26 · feedback หน้างาน):
--   โปรเจค "ลดดาวไทม์ Sensor / Reed มีปัญหา" อยู่ที่ **แผนงาน 0/5 ขั้น**
--   (ขั้นแรก "1. วิเคราะห์สาเหตุ (Plan)" ยังไม่เริ่มด้วยซ้ำ — ขึ้น ⚠ เลยแผน)
--   แต่การ์ดกลับโชว์ "📈 ผลจากข้อมูลจริง ▲ 95%" และ "Cost Saving · ต้นทุนเพิ่มขึ้น ~13,924 บาท/เดือน"
--   แล้วยอดนั้นถูกรวมขึ้นหัวเพจเป็น **"Cost Saving รวม −13,924"**
--   = ระบบสรุปผลของงานที่ยังไม่ได้ลงมือทำ แล้วเอาไปโชว์เป็นตัวเลขบริษัท
--
-- ต้นเหตุ: `start_date` ถูกตั้งเป็นวันเปิดโปรเจคโดยอัตโนมัติ และถูกใช้เป็น
--   "จุดตัดเทียบก่อน/หลัง" ทันที → ช่วงที่เรียกว่า "หลังแก้" คือช่วงที่ยังไม่ได้แก้อะไรเลย
--   (บทเรียนเดียวกับ CAPA effectiveness ที่ pivot ต้องเป็นวันมาตรการมีผลจริง — d6_effective_from)
--
-- กติกาใหม่ (ตามลำดับ PDCA):
--   Plan → กรอก **เป้าหมาย** (จะลดกี่ % / กี่หน่วยต่อวัน) → ระบบคำนวณ "คาดว่าจะประหยัด ~X บาท/เดือน"
--   Do   → กดยืนยัน "เริ่มลงมือแก้จริง" → stamp `do_started_at` + เลื่อน `start_date` เป็นวันนั้น
--   Check/Act → ผลจริงจากข้อมูลถึงเริ่มคำนวณ และเข้ายอด Cost Saving รวมของบริษัท
--
-- ⚠️ ไม่ backfill `do_started_at` โดยตั้งใจ
--    โปรเจคเดิมที่ยังไม่ได้ลงมือ (0/5 ขั้น) ต้องกลับไปเป็น "ยังไม่ยืนยันเริ่มลงมือ" ตามความจริง
--    การเดาจาก `action_taken` จะพลาดเคสข้างบนพอดี (ใบนั้นมี action_taken แต่ยังไม่เริ่มทำ)
--    ⇒ หน้าจอขึ้นปุ่มให้กดยืนยันเอง (ห้ามเงียบ)
--
-- Rollback: ดูท้ายไฟล์

alter table improvements add column if not exists target_mode  text;
alter table improvements add column if not exists target_value numeric;
alter table improvements add column if not exists do_started_at date;

comment on column improvements.target_mode  is 'หน่วยของเป้าหมาย: pct = ลดกี่ % · per_day = ลดลงกี่หน่วยต่อวัน (นาที/ชิ้น/ใบ ตามชนิดปัญหา)';
comment on column improvements.target_value is 'ค่าเป้าหมาย (ปริมาณที่ตั้งใจ "ลดลง" ไม่ใช่ค่าที่เหลือ) — null = ยังไม่ตั้งเป้า';
comment on column improvements.do_started_at is
  'วันที่ยืนยันว่า "เริ่มลงมือแก้จริง" (ขั้น Do) — null = ยังอยู่ช่วงวิเคราะห์/วางแผน ผลจริงยังไม่ถูกคำนวณ';

-- ค่าที่รับได้ของ target_mode (ปล่อย null ได้ = ยังไม่ตั้งเป้า)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'improvements_target_mode_chk') then
    alter table improvements add constraint improvements_target_mode_chk
      check (target_mode is null or target_mode in ('pct', 'per_day'));
  end if;
end $$;

-- เป้าหมายต้องเป็นบวก (0 = ไม่ได้ตั้งเป้า ให้ใช้ null แทน จะได้ไม่ปนกับ "ตั้งเป้าลด 0%")
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'improvements_target_value_chk') then
    alter table improvements add constraint improvements_target_value_chk
      check (target_value is null or target_value > 0);
  end if;
end $$;

-- Rollback:
--   alter table improvements drop constraint if exists improvements_target_mode_chk;
--   alter table improvements drop constraint if exists improvements_target_value_chk;
--   alter table improvements drop column if exists target_mode;
--   alter table improvements drop column if exists target_value;
--   alter table improvements drop column if exists do_started_at;
--   (โค้ดฝั่งเว็บ tolerant อยู่แล้ว — ไม่มีคอลัมน์ = ถอยไปพฤติกรรมเดิม ใช้ action_taken ตัดสิน)
