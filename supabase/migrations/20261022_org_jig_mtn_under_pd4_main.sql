-- 🏗️ JIG MTN ย้ายไปอยู่ใต้ส่วนงาน PD4 + เคลียร์บัญชีที่ชี้โหนด DIE ซ้ำ (2026-10-22 · คำสั่ง user)
--   user: "jig mtn ใต้ pd4, die mtn ใต้ tooling ไม่เกี่ยวกับ pd1 เราผิด แค่ ผจก คนเดียวกัน"
--
-- เดิม JIG MTN เป็น "แผนกขึ้นตรงฝ่าย" (parent_id = null) ⇒ ลำดับชั้น/รหัส CC ตกทอดไม่ได้
-- ผลที่ตั้งใจ: ขอบเขตของ PD4 ครอบ JIG MTN ตามลำดับชั้น (ccScope.scopeCovers)
-- วัดก่อนย้าย: JIG MTN มีพนักงานผูก 8 คน · บัญชีอ้างชื่อ 11 ใบ · ไม่มี org_assignments/rate อ้างถึง
-- apply แล้ว 2026-10-22 · ตรวจกลับ: parent = PD4
update public.org_nodes
   set parent_id = (select id from public.org_nodes where kind='section' and name='PD4' limit 1)
 where kind='department' and name='JIG MTN' and parent_id is null;

-- 🧹 บัญชีที่ section ยังชี้โหนดซ้ำที่ปิดใช้งานแล้ว ('DIE MTN' = DIE Maintenance 2140561100)
--    ให้ชี้โหนดจริงที่ใช้งานอยู่ใต้ Tooling MTN ('Die MTN' 2140559101) · 2 แถว
update public.profiles set section = 'Die MTN' where section = 'DIE MTN';

-- ROLLBACK:
--   update public.org_nodes set parent_id = null where kind='department' and name='JIG MTN';
--   update public.profiles set section = 'DIE MTN' where section = 'Die MTN';  -- (เฉพาะ 2 บัญชีนั้น)
