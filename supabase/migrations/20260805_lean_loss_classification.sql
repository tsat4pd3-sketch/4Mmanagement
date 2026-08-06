-- Lean analysis: 6 Big Losses + 8 Wastes — จำแนกที่ master ที่มีอยู่ (DR project · 2026-08-05)
-- ═══════════════════════════════════════════════════════════════════════════════
-- คำสั่ง user: ไม่แตะ category ในแผน/นอกแผน (แต่ละบริษัทนิยาม KPI ต่างกัน — เป็นสิทธิ์ของเขา)
-- แต่อยากได้การวิเคราะห์ตามหลัก Lean → เพิ่ม "แกนวิเคราะห์" แยกจาก category ที่ใช้คิด OEE
--   · six_big_loss : 6 Big Losses (TPM) — breakdown / setup / minor_stop / reduced_speed / defect / startup
--   · waste_type   : 8 Wastes (DOWNTIME) — defect / overproduction / waiting / non_utilized /
--                    transportation / inventory / motion / extra_processing
-- ทั้งคู่ nullable = ยังไม่จำแนก (แสดงเป็น "ยังไม่จัดหมวด" ในหน้าวิเคราะห์ ไม่เดาให้)
-- ปรับได้เองจาก Daily Report → ⚙️ ตั้งค่า → ประเภท Downtime / ประเภทงานเสีย (data-driven ไม่ hardcode)

alter table dr_downtime_types add column if not exists six_big_loss text;
alter table dr_downtime_types add column if not exists waste_type   text;
alter table dr_defect_types   add column if not exists six_big_loss text;
alter table dr_defect_types   add column if not exists waste_type   text;

-- seed ค่าเริ่มต้นจากชื่อประเภทที่มีอยู่จริง (แก้ทับได้ทุกเมื่อ — เป็นแค่จุดตั้งต้นให้ไม่ต้องกรอกจากศูนย์)
-- ⚠️ seed เฉพาะแถวที่ยังว่าง (idempotent · ไม่ทับค่าที่ผู้ใช้ตั้งเอง)
update dr_downtime_types set six_big_loss = case
    when name_th ~* 'เสีย|breakdown|ขัดข้อง|ชำรุด|แตก|หลุด|alarm|ไฟดับ|error' then 'breakdown'
    when name_th ~* 'set ?up|เซ็ตอัพ|เปลี่ยนรุ่น|เปลี่ยนแม่พิมพ์|ปรับตั้ง|change ?over' then 'setup'
    when name_th ~* 'รอ|ขาด|หมด|เปลี่ยนตะกร้า|เปลี่ยนภาชนะ|ติดขัด|jam'              then 'minor_stop'
    when name_th ~* 'ช้า|speed|ความเร็ว'                                            then 'reduced_speed'
    when name_th ~* 'ซ่อมงาน|rework|แก้งาน|คัดแยก|ของเสีย'                          then 'defect'
    when name_th ~* 'เริ่มเดินเครื่อง|start ?up|warm|ทดลอง|ลองงาน'                  then 'startup'
  end
where six_big_loss is null;

update dr_downtime_types set waste_type = case
    when name_th ~* 'รอ|ขาด|หมด|ไฟดับ|เสีย|breakdown|ขัดข้อง|alarm'  then 'waiting'
    when name_th ~* 'ขน|ย้าย|เคลื่อนย้าย|transport|ลำเลียง'          then 'transportation'
    when name_th ~* 'เดิน|หยิบ|ค้นหา|หา ?ของ|motion'                 then 'motion'
    when name_th ~* 'ซ่อมงาน|rework|แก้งาน|คัดแยก|ของเสีย|ตรวจซ้ำ'   then 'defect'
    when name_th ~* 'สต๊อก|stock|คลัง|inventory'                     then 'inventory'
    when name_th ~* 'ตรวจ|inspect|qa|ตั้งค่า|ปรับ'                   then 'extra_processing'
    when name_th ~* 'อบรม|ประชุม|training|meeting'                   then 'non_utilized'
  end
where waste_type is null;

-- ของเสียทุกประเภท = 6th loss "defect" + waste "defect" โดยธรรมชาติ
update dr_defect_types set six_big_loss = 'defect' where six_big_loss is null;
update dr_defect_types set waste_type   = 'defect' where waste_type   is null;

-- pass 2: ชื่อประเภทที่โรงงานนี้ใช้จริงแต่ยังไม่เข้าเกณฑ์ pass 1 (เหลือ 35 รายการ)
-- "อื่นๆ" คงเป็น null โดยตั้งใจ — ไม่รู้จริงว่าเป็น loss แบบไหน ต้องให้คนจัด
update dr_downtime_types set six_big_loss = case
    when name_th ~* 'มีปัญหา|ชำรุด|ติด|จับงานไม่ได้|error|ตก|แตก|หัก' then 'breakdown'
    when name_th ~* 'เปลี่ยน (cap|electrode|ดอก|ถัง|หัว)|ทำความสะอาด|ล้างแม่พิมพ์|เปลี่ยนถัง' then 'minor_stop'
    when name_th ~* 'แก้ไขปัญหาคุณภาพ|วัสดุไม่ได้มาตรฐาน|ของแข็งเกิน' then 'defect'
    when name_th ~* 'ปรับ (ค่า|แนว|แม่พิมพ์)|tonnage|clearance' then 'setup'
    when name_th ~* 'หยุดแก้ไขไลน์' then 'breakdown'
  end
where six_big_loss is null;

update dr_downtime_types set waste_type = case
    when name_th ~* 'มีปัญหา|ชำรุด|error|ติด' then 'waiting'
    when name_th ~* 'เปลี่ยน (cap|electrode|ดอก|ถัง|หัว)|ทำความสะอาด|ล้าง' then 'motion'
    when name_th ~* 'แก้ไขปัญหาคุณภาพ|วัสดุไม่ได้มาตรฐาน|ของแข็งเกิน|คัดแยก' then 'defect'
    when name_th ~* '5ส|improved line|หยุดแก้ไขไลน์' then 'non_utilized'
  end
where waste_type is null;
