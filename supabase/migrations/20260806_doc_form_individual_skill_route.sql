-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- ใบประเมินทักษะรายบุคคล (F-PRS-P1-119) พิมพ์ได้จาก 2 หน้าแล้ว (2026-08-06)
-- เดิมกดดูการ์ดสรุปทักษะ + พิมพ์ใบได้เฉพาะ /skills-report (แท็บ Skill Matrix)
-- ตอนนี้การ์ดเป็น component กลาง (src/components/SkillRadarPanel.jsx) หน้าฐานข้อมูล
-- พนักงาน /operator ก็กดดู+พิมพ์ใบเดียวกันได้ → อัพเดท used_route ให้ตรงความจริง
-- (used_route = ข้อมูลแสดงในทะเบียน /doc-forms ให้ doc_control รู้ว่าฟอร์มออกจากหน้าไหน
--  ไม่มีผลต่อ logic การพิมพ์ — โค้ดอ้างด้วย doc_key เท่านั้น)

update doc_forms
   set used_route = '/skills-report, /operator',
       updated_at = now()
 where doc_key = 'individual_skill'
   and coalesce(used_route, '') = '/skills-report';
