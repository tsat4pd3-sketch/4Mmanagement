-- ═══════════════════════════════════════════════════════════════════════════
-- แก้หมวดกำพร้าใน permission_catalog: org:manage_divisions  (Main project)
-- QC audit 2026-08-24
--
-- ที่มา: `20260818_org_divisions.sql` seed แถวนี้ด้วย group_name = 'ตั้งค่า/ฐานข้อมูล'
--        ซึ่ง **ไม่มีใน NAV_GROUP_ORDER** (ชื่อจริงคือ 'ตั้งค่าโปรแกรม,ฐานข้อมูล')
--        → แท็บ "สิทธิ์การทำงาน" ใน /permissions มีหมวดเดี่ยวโผล่กลางตาราง
--
-- เป็นบั๊กคลาสเดียวกับที่ `20260819_permission_catalog_regroup.sql` ไล่เก็บไปแล้ว
-- ('ซ่อมบำรุง' / 'ประชุมแถวเช้า' / 'รายงาน/คุณภาพ') แต่แถวนี้ตกสำรวจ เพราะ migration
-- 08-18 ถูก apply หลังจาก audit รอบนั้นรันไปแล้ว
--
-- cosmetic ล้วน — **ไม่แตะ role_permissions** ใครมีสิทธิ์อะไรอยู่ก็เท่าเดิมทุกประการ
-- sort 940: อยู่ต่อจาก doc_forms:manage (935) ตามลำดับหมวดตั้งค่าฯ (9xx) และยังไม่มีใครใช้
--
-- รันซ้ำได้ (idempotent)
-- ═══════════════════════════════════════════════════════════════════════════

update public.permission_catalog
   set group_name = 'ตั้งค่าโปรแกรม,ฐานข้อมูล',
       sort       = 940
 where resource = 'org' and action = 'manage_divisions';

-- ── ตรวจผลหลังรัน: ต้องได้ 9 หมวด และไม่มีชื่อหมวดนอก NAV_GROUP_ORDER ──
-- select group_name, count(*), min(sort), max(sort)
--   from public.permission_catalog group by group_name order by min(sort);
--
-- select resource, action, group_name, sort
--   from public.permission_catalog
--  where group_name not in ('ภาพรวม','ฝ่ายผลิต','วิเคราะห์ & รายงาน','พนักงาน & ทักษะ',
--        'Logistic - Store','การตรวจสอบและซ่อมบำรุง','ควบคุมคุณภาพ QA/QC','วิศวกรรม (PE)',
--        'ตั้งค่าโปรแกรม,ฐานข้อมูล');   -- ต้องได้ 0 แถว
