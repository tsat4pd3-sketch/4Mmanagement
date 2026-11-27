-- ═══ nav_groups v4: เพิ่มหมวด "กิจกรรม" ต่อจาก "คุณภาพ & วิศวกรรม" (2026-11-25 · คำสั่ง user) ═══
-- Target project: MAIN "MAIN" (ewhdfqwfwofivojtsizn) — รันหลัง 20260930_nav_groups_v3_planning_store.sql
--
-- ⚠️ **ยังไม่ได้รัน** — user 25/11 "ยังไม่เพิ่มฐานข้อมูล" · หน้ากิจกรรม 9 หน้าเป็นโครง admin เห็นก่อน
--    ไฟล์นี้มีเพราะด่าน build `navGroupsRegistry.test.mjs` บังคับให้ทะเบียนหมวดใน migration ตรงกับ NAV_GROUP_ORDER
--    ⇒ รันตอนเปิดสิทธิ์หน้ากิจกรรมให้ role อื่น (พร้อม seed permission_catalog ช่วง sort 800–899)
-- ⚠️ cosmetic ล้วน — ไม่แตะ role_permissions · ไม่สร้างตาราง · idempotent (upsert ทั้งชุด)

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
  ('กิจกรรม',                                                   10, 800, 899),
  ('ตั้งค่าโปรแกรม,ฐานข้อมูล',                                   11, 900, 949),
  ('ผู้บริหาร & เดโม',                                           12, 950, 999)
on conflict (name) do update
  set seq = excluded.seq, sort_lo = excluded.sort_lo, sort_hi = excluded.sort_hi, updated_at = now();

-- ── ตรวจหลังรัน (MAIN) ──
-- select seq, name, sort_lo, sort_hi from nav_groups order by seq;   -- 12 แถว · 'กิจกรรม' seq 10 (800–899)

-- ── Rollback (MAIN · ทำได้เมื่อยังไม่มีคีย์ใน permission_catalog ของหมวดนี้ — FK RESTRICT) ──
--   delete from nav_groups where name = 'กิจกรรม';
--   update nav_groups set seq = 10 where name = 'ตั้งค่าโปรแกรม,ฐานข้อมูล';
--   update nav_groups set seq = 11 where name = 'ผู้บริหาร & เดโม';
