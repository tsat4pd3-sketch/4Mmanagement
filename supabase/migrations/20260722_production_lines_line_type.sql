-- ประเภทไลน์ผลิต (ปั๊ม/ไฮโดรฟอร์ม/เลเซอร์/เชื่อมประกอบ/อื่นๆ) — คำสั่ง user 2026-07-22
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn)
-- ตั้งค่าที่หน้า ⚙️ ตั้งค่าผังไลน์ (LineSetup — แผง Standard Manpower)
-- ค่าที่ใช้ได้ดู src/utils/lineTypes.js (stamping/hydroform/laser/welding_assembly/other)
-- หมายเหตุ: additive — คอลัมน์ nullable ไม่กระทบโค้ด/query เดิม

alter table production_lines add column if not exists line_type text;

-- backfill จากชื่อไลน์แบบระวัง (เฉพาะที่ชื่อ/ไลน์แม่บอกประเภทชัดเจน — ที่เหลือปล่อย null ให้หัวหน้าตั้งเอง)
update production_lines set line_type = 'hydroform'
 where line_type is null
   and (upper(name) like '%HYDROFORM%' or upper(name) like 'HDF%'
        or upper(coalesce(parent_line_name, '')) like '%HYDROFORM%');

update production_lines set line_type = 'laser'
 where line_type is null and upper(name) like '%LASER%';

update production_lines set line_type = 'welding_assembly'
 where line_type is null
   and (upper(name) like '%ASSY%' or upper(name) like '%ASSEMBLY%' or upper(name) like '%WELD%');

-- Rollback:
--   alter table production_lines drop column if exists line_type;
--   (โค้ดเวอร์ชันก่อนหน้าไม่ select คอลัมน์นี้ — revert โค้ดก่อนแล้วค่อย drop ตามลำดับปกติ)
