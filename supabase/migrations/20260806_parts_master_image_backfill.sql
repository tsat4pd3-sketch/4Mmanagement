-- ═══════════════════════════════════════════════════════════════════════════
-- รูปพาร์ท = ตัวตนของพาร์ท → อยู่ที่ทะเบียนกลาง parts_master (2026-08-06)
-- DR project (eyhclzkifitbhbljgoav)
--
-- สภาพก่อนแก้: รูปทั้งหมดถูกอัปโหลดไว้ฝั่ง dr_products (34/34 แถวมีรูป)
-- ส่วน parts_master มี 0 — ทั้งที่คอลัมน์ image_url และ UI อัปโหลดมีอยู่แล้ว
-- backfill: copy URL จาก dr_products เข้า parts_master ที่ mat ตรงกันและทะเบียนยังว่าง
-- (แชร์ URL ไฟล์เดียวกัน — guard การลบไฟล์ฝั่งโค้ดเช็คข้ามตารางแล้วทั้ง 2 ทาง)
-- ═══════════════════════════════════════════════════════════════════════════

update parts_master pm
set image_url = dp.image_url
from (
  select distinct on (mat_no) mat_no, image_url
  from dr_products
  where coalesce(image_url, '') <> ''
  order by mat_no, effective_from desc nulls last
) dp
where pm.mat_no = dp.mat_no
  and coalesce(pm.image_url, '') = '';
