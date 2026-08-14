-- เคลียร์คิวอนุมัติ 4M Man ที่ค้างจากบั๊กเกณฑ์สกิล (Main project)
--
-- ที่มา: พ.ค. 2026 ระบบสร้าง 4M Man อัตโนมัติ ("[Auto] <ชื่อ> ประจำจุด <จุดงาน> เป็นครั้งแรก")
-- จากบั๊กการเทียบเกณฑ์สกิล — ไม่ใช่การเปลี่ยนแปลงกำลังคนจริง ไม่มีอะไรให้ SV/QA พิจารณา
-- ตัวสร้างถูกแก้ไปแล้ว (ข้อมูลจริง: แถว [Auto] มีเฉพาะ 18-27 พ.ค. 2026 · มิ.ย. เป็นต้นมา = 0)
-- แต่ของเก่า 323 ใบยังค้างคิวอนุมัติ กลบใบจริงจนหัวหน้ามองไม่เห็นงานที่ต้องทำ
--
-- วิธี: ตั้งเป็น 'rejected' (สถานะปลายทางที่หลุดจากทุกจอ "งานค้าง") ไม่ลบทิ้ง
--       4M เป็นบันทึกคุณภาพ (CQI-15 / Changing Point) — ลบแล้วสืบย้อนไม่ได้
--       สถานะเดิมถูกฝังใน reject_reason เพื่อให้ rollback ได้ตรงใบ
--
-- ผลที่คาด (ตรวจ 2026-08-10): pending 246 · pending_qa 77 = 323 แถว
-- ไม่แตะ: [Auto] ที่ approved ไปแล้ว 69 ใบ (ปิดเรื่องแล้ว) · 4M ที่คนกรอกเองทุกใบ
--
-- Rollback:
--   update four_m_logs set
--     status = case when reject_reason like '%(สถานะเดิม: pending_qa)' then 'pending_qa' else 'pending' end,
--     reject_reason = null, approved_at = null
--   where status = 'rejected' and reject_reason like 'ยกเลิกอัตโนมัติ 2026-08-10:%';

update four_m_logs
set status        = 'rejected',
    approved_at   = now(),
    reject_reason = 'ยกเลิกอัตโนมัติ 2026-08-10: ใบนี้ระบบสร้างเองจากบั๊กเกณฑ์สกิล (พ.ค. 2026) '
                 || 'ไม่ใช่การเปลี่ยนแปลงกำลังคนจริง จึงปิดคิวโดยไม่ต้องพิจารณา (สถานะเดิม: ' || status || ')'
where category = 'Man'
  and description like '[Auto]%'
  and work_date < '2026-06-01'
  and status in ('pending', 'pending_qa');
