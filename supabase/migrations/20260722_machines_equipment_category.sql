-- ฐานข้อมูลเครื่องจักร — รองรับ Facility/Utility (ไม่ผูกไลน์ผลิต) · DR project (eyhclzkifitbhbljgoav)
-- ปัญหา: เดิม machines บังคับผูกไลน์ผลิต → เพิ่ม facility ของโรงงาน (น้ำ/ลม/High Pressure) ไม่ได้
--   เพราะ facility ไม่ได้อยู่ใต้ไลน์ผลิต (คำสั่ง user 2026-07-22 — น้องหน้างานติดปัญหา)
-- แก้: equipment_category ('production'/'facility'/'utility') · facility/utility เก็บชื่อระบบใน line_name
-- additive · เครื่องเดิม = production (default)
alter table public.machines add column if not exists equipment_category text default 'production';
