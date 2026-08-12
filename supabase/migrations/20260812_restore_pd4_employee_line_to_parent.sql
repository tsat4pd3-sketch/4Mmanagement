-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- ด่วน: เช็คชื่อ PD4 หายหมด (2026-08-12) — apply แล้ว 2026-08-12
--
-- ตอนจัดข้อมูลพนักงานให้ตรงผังองค์กร ฟอร์มเลือกกลุ่ม "GOR ASSY"/"LWRBAR ASSY"
-- ซึ่ง org_nodes.ref_line_id ชี้ไป "ไลน์ลูก" (Assy GOR/Assy LWR/Laser GOR/Laser LWR)
-- → employees.line_id ย้ายจากไลน์แม่ไปไลน์ลูก
-- → หัวหน้ากลุ่มที่ผูกกับไลน์แม่ (GOR id=10 / LWR BAR id=8) เปิดหน้าเช็คชื่อเห็น 0 คน
--   (หัวหน้า 4 คน · พนักงาน 41 คน · เช้าวันที่ 12 ส.ค. เช็คชื่อไม่ได้ทั้ง PD4)
--
-- โค้ดแก้แล้วในคอมมิทเดียวกัน (scope ของ leader = ทั้งครอบครัวไลน์ ไม่ใช่ line_id ตรงตัว)
-- แต่คืน line_id กลับไลน์แม่ด้วย เพราะ:
--   1) ใช้งานได้ทันทีบน build เดิมที่หน้างานเปิดอยู่ ไม่ต้องรอ deploy
--   2) ตรงกับ convention ที่ระบบใช้มาตลอด — employees.line_id ผูกกับ "ไลน์แม่"
--      (ดู CLAUDE.md §กำลังคนมาตรฐาน: ตัวเลขระดับกลุ่มอยู่ที่ไลน์แม่ · พนักงานจริงผูกไลน์แม่ 100%)
--
-- ⚠️ ไม่แตะ group_name — ข้อมูลกลุ่มที่จัดให้ตรงผังไว้แล้วยังอยู่ครบทุกคน
-- ⚠️ ตรวจแล้ว PD4 ไม่มี workstations เลย (0 ทุกไลน์) การย้ายจึงไม่กระทบจุดงาน/จุดประจำ
-- ⚠️ daily_production_logs ผูกด้วย employee_id ไม่ใช่ line_id → ประวัติเช็คชื่อเดิมไม่กระทบ
--
-- ROLLBACK (คืนไปไลน์ลูกตาม group_name — ทำได้เมื่อ build ใหม่ deploy แล้ว):
--   update employees e set line_id = l.ref_line_id
--     from org_nodes l where l.kind='line' and l.is_active
--      and l.name = e.group_name and e.is_active and e.section='PD4';

update employees e
   set line_id = p.id
  from production_lines c
  join production_lines p on p.name = c.parent_line_name
 where e.line_id = c.id
   and e.is_active
   and c.section = 'PD4';
