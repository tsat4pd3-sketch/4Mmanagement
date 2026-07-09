-- Multi-section scoping: จำกัดขอบเขตข้อมูลของ user ได้หลายส่วนงาน (ไม่ใช่แค่ 1 section)
-- ใช้คู่กับ src/utils/sectionScope.js — NULL/array ว่าง = ไม่จำกัด (พฤติกรรมเดิม)
-- supervisor เดิมที่ใช้ profiles.section เดี่ยวยังทำงานเหมือนเดิมผ่าน fallback ฝั่ง client
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sections text[];

COMMENT ON COLUMN public.profiles.sections IS
  'ขอบเขตส่วนงานที่ user เห็นข้อมูล (หลายค่า เช่น {PD1,PD2}) — NULL/ว่าง = ตาม logic เดิม (supervisor ใช้ section เดี่ยว, role อื่นเห็นทุกส่วนงาน)';

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- โค้ดเวอร์ชันก่อนฟีเจอร์นี้ไม่อ่านคอลัมน์นี้ — revert โค้ดอย่างเดียวก็พอ ไม่ drop ก็ไม่พัง
-- ถ้าต้องการถอนออกจริง:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS sections;
-- ดูขั้นตอนเต็มใน docs/ROLLBACK_MULTI_SECTION_SCOPE.md
