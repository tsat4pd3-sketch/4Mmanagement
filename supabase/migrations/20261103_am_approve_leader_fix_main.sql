-- 🔧 แก้ seed ของ 20261102_am_approve_permission_main.sql (Main · apply แล้ว 03/11 ผ่าน MCP)
-- ปัญหา: role leader มีแถว pm:approve = false อยู่แล้ว ⇒ insert แรก (copy จาก pm:approve) สร้าง am:approve = false
--        แล้ว insert ที่ตั้งใจให้ leader = true ถูกข้าม (not exists) ⇒ หัวหน้ากลุ่มยังอนุมัติ AM ไม่ได้ ผิดจุดประสงค์ของ B2
-- ทางแก้: ตั้ง leader am:approve = true (หัวหน้ากลุ่ม = ชั้นที่ 2 ของสาย AM · src/utils/amApproval.js)
-- ย้อนกลับ: update role_permissions set allowed = false where role = 'leader' and permission_key = 'am:approve';
update role_permissions set allowed = true
where role = 'leader'::user_role and permission_key = 'am:approve' and allowed = false;
-- ตรวจผล: select role, allowed from role_permissions where permission_key = 'am:approve' order by 1;
