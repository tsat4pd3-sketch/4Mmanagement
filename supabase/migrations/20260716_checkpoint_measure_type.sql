-- Checkpoint type "measure" — ค่าวัดเครื่องจักร (2026-07-16)
-- Project: DR/Product (eyhclzkifitbhbljgoav) — client `supabaseDR` (role anon เสมอ)
--
-- Variable(SPC) = QA วัดชิ้นงาน (nominal±พิกัด, 3 ค่าเฉลี่ย, control limit) — ไม่เหมาะเช็คเครื่อง
-- เพิ่ม type 'measure' = อ่านค่าครั้งเดียว + เกณฑ์ ≥ต่ำสุด/≤สูงสุด/ช่วง → เทียบตัวเลข auto OK/NG
--   ใช้คอลัมน์เดิม: lsl = ค่าต่ำสุด, usl = ค่าสูงสุด, unit = หน่วย (ไม่ใช้ nominal/lcl/ucl)
--   comparator derive จากช่องที่กรอก: lsl only=≥ · usl only=≤ · ทั้งคู่=ช่วง
--
-- Additive & backward-compatible: แค่ขยาย CHECK ให้รับ 'measure' — type เดิมไม่กระทบ
alter table public.jig_checkpoints
  drop constraint if exists jig_checkpoints_type_check;
alter table public.jig_checkpoints
  add constraint jig_checkpoints_type_check
  check (type = any (array['variable','attribute','note','measure']));
