-- ═══ เลขวัตถุดิบ (5xx) ที่ถูกใช้เป็น "ของที่ผลิตได้" = ที่จริงมันคือ **ขั้นตอน (OP)** ═══
-- DR project · "Product DB" · eyhclzkifitbhbljgoav   (2026-10-05 · คำสั่ง user · **apply แล้ว**)
--
-- กฎ (user ยืนยัน · ตรงกับ MAT_CLASSES ใน src/utils/matPrefix.js):
--   5xx = Raw Material = วัตถุดิบที่เอาเข้ามาผลิต เป็น input เท่านั้น
--   => เป็น "ของที่ออกจากกระบวนการ" ไม่ได้
-- ของจริง: ไลน์เลเซอร์บันทึก "ขั้นตอนตัด" โดยใช้เลขวัตถุดิบเป็นชื่อของที่ผลิตได้ (4 เลข 208 ใบ)
--
-- op_parent_mat (ทั้งหมดมาจากที่ user ยืนยัน ไม่ได้เดา):
--   · 50029017 -> 20058498   "จาก laser gor จะต้องไปต่อ assy gor"
--   · 50031625 -> 10105769   (แถวประวัติ — ให้ตรงกับแถวปัจจุบัน BENDING LWR BAR 306 ที่ ADMIN ตั้งไว้)
--   · 50031601/02 -> **null** — "พาร์ทจาก hydroform ไปต่อ assy 60/61 แยกซ้ายขวา" แต่ฝั่ง RH
--     ยังมีผู้สมัคร 4 ตัว (FTM/AAT/FVL/ชุบดำ) ⇒ เลือกแทนคนไม่ได้ (ห้ามเดา)
--     ระบบรองรับ OP ที่ยังไม่ผูกแม่อยู่แล้ว (collapseOps: parent null = นับแบบเดิม ไม่พัง)
--     => โผล่ชิป 🔩 OP · ยังไม่ผูกพาร์ทจริง (สีเหลือง) ใน /products ให้ PE มาเติม
--
-- ผลที่ตั้งใจ: <ProductSelect> ตัดแถว OP ออกเป็น default => เลข 5xx หายจาก dropdown พาร์ท
-- ไม่กระทบการเปิดใบ: แถวคัมบังของ 50029017/50031601 ไม่ได้ผูก product อยู่แล้ว
--                   (scopeMatRows กรองออกเพราะไม่รู้ไลน์เจ้าของ) · ใบทุกใบเป็น is_manual
--
-- ROLLBACK:
--   update public.dr_products set is_operation = false, op_parent_mat = null
--    where mat_no in ('50029017','50031601','50031602')
--       or (mat_no = '50031625' and is_active = false);
-- ═══════════════════════════════════════════════════════════════════════════════════════

update public.dr_products
   set is_operation  = true,
       op_parent_mat = case when mat_no = '50029017' then '20058498' else op_parent_mat end,
       updated_by_name = 'ระบบ: 5xx = วัตถุดิบ ใช้เป็นของที่ผลิตได้ไม่ได้ จึงตั้งเป็นชั้น OP'
 where mat_no in ('50029017', '50031601', '50031602')
   and is_operation = false;

-- แถวประวัติของ Laser LWR (ดู 20261005_dr_products_restore_50031625_history.sql)
update public.dr_products
   set is_operation = true, op_parent_mat = '10105769',
       updated_by_name = 'ระบบ: แถวประวัติของ BENDING LWR BAR 306 — ตั้งเป็นชั้น OP ให้ตรงกับแถวปัจจุบัน'
 where mat_no = '50031625' and is_active = false;
