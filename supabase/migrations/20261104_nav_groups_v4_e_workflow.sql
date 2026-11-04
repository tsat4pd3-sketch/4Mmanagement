-- ═══ nav_groups v4: เพิ่มหมวด "E-Workflow" (2026-11-04 · คำสั่ง user) ═══
-- Target project: MAIN "MAIN" (ewhdfqwfwofivojtsizn) — รันหลัง 20260930_nav_groups_v3_planning_store.sql
--
-- user: *"เพิ่ม sidebar เป็นหน้า E-workflow … ดึงพวกที่เราเคยทำไว้ ใบประกาศ ขอค่าเดินทาง จะยุบเป็นหมวดเดียว"*
--   → เลือก "หมวดใหม่บน sidebar" · สมาชิก: /e-workflow (OCR mockup) · /announcements · /overseas-travel
--
-- ⚠️ cosmetic ล้วน — **ไม่แตะ permission_catalog / role_permissions** (วัด 04/11: ไม่มีคีย์ใน catalog
--    ที่อยู่หมวด "ผู้บริหาร & เดโม" หรือในช่วง sort 800–899 เลย ⇒ ไม่มีคีย์ต้องย้าย)
-- ⚠️ ช่วง sort 800–899 = ช่องว่างเดิมระหว่าง คุณภาพ (700–799) กับ ตั้งค่า (900–949) ⇒ ช่วงของหมวดอื่นไม่ขยับ
-- ⚠️ `nav_groups_seq_key` = UNIQUE DEFERRABLE INITIALLY DEFERRED ⇒ เลื่อน seq 10/11 → 11/12 ในคำสั่งเดียวได้

-- ทะเบียนเต็มชุด = NAV_GROUP_ORDER ณ 2026-11-04 (บรรทัดละหมวด · เทส navGroupsRegistry อ่าน format นี้ ห้ามจัดใหม่)
insert into public.nav_groups (name, seq, sort_lo, sort_hi) values
  ('ภาพรวม',                                                     1, 100, 149),
  ('จอแสดงผล',                                                   2, 150, 199),
  ('ฝ่ายผลิต',                                                    3, 200, 299),
  ('วิเคราะห์ & รายงาน',                                          4, 300, 399),
  ('พนักงาน & ทักษะ',                                             5, 400, 499),
  ('Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)',      6, 500, 519),
  ('Logistic - Warehouse & Delivery (ส่งลูกค้า)',                 7, 520, 539),
  ('การตรวจสอบและซ่อมบำรุง',                                      8, 600, 699),
  ('คุณภาพ & วิศวกรรม',                                           9, 700, 799),
  ('E-Workflow',                                                 10, 800, 899),
  ('ตั้งค่าโปรแกรม,ฐานข้อมูล',                                   11, 900, 949),
  ('ผู้บริหาร & เดโม',                                           12, 950, 999)
on conflict (name) do update
  set seq = excluded.seq, sort_lo = excluded.sort_lo, sort_hi = excluded.sort_hi, updated_at = now();

-- ── ตรวจหลังรัน (MAIN) ──
-- select seq, name, sort_lo, sort_hi from nav_groups order by seq;   -- 12 แถว · E-Workflow = seq 10 (800–899)
-- select * from v_permission_catalog_sort_drift;                      -- 0 แถว

-- ── Rollback (MAIN · revert โค้ดฝั่งเว็บก่อน — ชื่อต้องตรง NAV_GROUP_ORDER เสมอ) ──
--   delete from nav_groups where name = 'E-Workflow';   -- FK RESTRICT: ล้มถ้ามีคีย์ catalog อยู่หมวดนี้แล้ว
--   update nav_groups set seq = 10 where name = 'ตั้งค่าโปรแกรม,ฐานข้อมูล';
--   update nav_groups set seq = 11 where name = 'ผู้บริหาร & เดโม';
