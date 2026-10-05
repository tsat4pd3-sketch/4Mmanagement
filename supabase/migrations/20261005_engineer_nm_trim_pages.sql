-- ══ engineer_nm: จำกัดขอบเขตให้ "เทส New Model ได้ แต่แตะงานแมสไม่ได้" (2026-10-05 · คำขอ user) ══
-- โจทย์ user: *"สร้าง user ไว้ให้ทีม new model เข้ามาลองเทส function new model
--              ที่จะไม่ยุ่งไม่กระทบกับงานหลักที่แมสอยู่ปัจจุบันที่เรารันมา"*
--
-- 🔑 ปิดด้วย `allowed = false` ไม่ใช่ `delete` — คงแถวไว้ให้เห็น/กดสลับเองได้ที่ /permissions
--    (hasPermission fail-closed: แถวหาย = ปฏิเสธเหมือนกัน แต่หายจากจอ = ต้องมา SQL ใหม่ทุกครั้ง
--     ซึ่ง user ทำไม่ได้เอง มีแค่ SQL Editor บนเว็บ)
--
-- 1) `page:/storage-maintenance` — ติดมากับ 20260922 ที่ seed ด้วย array รวม engineer_nm
--    หน้านั้นเป็นเครื่องมือดูแลระบบหลัก (ไล่ไฟล์กำพร้าใน storage) ไม่ใช่ฟังก์ชัน New Model
--    ⚠️ ปุ่มลบจริงถูกกันด้วย `storage_maintain:run` ซึ่ง engineer_nm ไม่มีอยู่แล้ว
--       = วันนี้ยังลบอะไรไม่ได้ · ปิดเพื่อไม่ให้เห็นในเมนู ลดโอกาสหลงเข้าไปกด
--
-- 2) 🔴 `pe:edit` — คีย์เดียวที่ "แตะงานแมสได้จริง" ตามโจทย์ user
--    `/pe-docs` เก็บ PFC/PFMEA/Control Plan **ของจริงที่ใช้ผลิตอยู่** และสิทธิ์เป็น "ต่อ role"
--    ไม่ใช่ "ต่อพาร์ท" ⇒ แก้แถวของพาร์ทที่แมสอยู่ได้ · ตาราง `pe_*` ถูกอ่านต่อที่
--    QualityControl (ลูป 8D) · OrderTrace · VSM · AdoptionOutlook ⇒ แก้ผิดจุดเดียวกระเพื่อมหลายจอ
--    ⇒ ปิดไว้ก่อน: ทีม NM ยัง **เปิดอ่าน** /pe-docs ได้ (page ยังเปิด) แต่แก้ไม่ได้
--    PFMEA ของพาร์ทใหม่เดินผ่าน /npi + ลูปเสนอเข้า PFMEA master (`pe_master_proposals`) ตามปกติ
--    👉 ถ้า user ตัดสินใจให้ทีม NM ร่าง PFMEA เองได้ → เปิดกลับที่ /permissions (role 🚀) คลิกเดียว
--
-- ไม่กระทบใคร: ตอน apply ยังไม่มี user คนไหนถือ role นี้เลย (วัดจาก profiles 2026-10-05)
-- Rollback (เปิดกลับทั้งคู่):
--   update role_permissions set allowed = true
--    where role = 'engineer_nm'
--      and permission_key in ('page:/storage-maintenance','pe:edit');

update role_permissions
   set allowed = false
 where role = 'engineer_nm'
   and permission_key in ('page:/storage-maintenance', 'pe:edit');

-- ตรวจผลหลังรัน — ต้องได้ allowed=true เฉพาะ:
--   page:/npi · page:/pe-docs · page:/nm-board · page:/program-update · page:/schema · npi:edit
-- select permission_key, allowed from role_permissions
--  where role = 'engineer_nm' order by allowed desc, permission_key;
