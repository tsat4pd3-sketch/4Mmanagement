-- ═══ nav_groups: เปลี่ยนชื่อหมวด Logistic จาก "ขาเข้า/ขาออก" เป็นชื่อตามแผนกเจ้าของ (2026-09-07 · คำสั่ง user) ═══
-- Target project: MAIN (ewhdfqwfwofivojtsizn) — รันหลัง 20260907_nav_groups_registry.sql
--
-- เหตุผล: "ขาเข้า (Inbound)" อิงรั้วโรงงาน แต่หมวดนี้มี 5 หน้า มีแค่รับของซื้อจาก supplier ที่เป็นขาเข้าจริง
--   ที่เหลือ (สต๊อกในไลน์ · บอร์ดคัมบัง · ขนส่ง · เฝ้าระวังสต๊อก · ลูปเรียกชิ้นส่วน) คือสโตร์ **ป้อนของเข้าไลน์
--   ภายในโรงงาน** ซึ่งเป็นงานส่วนใหญ่ของสโตร์ (จ่ายเข้าไลน์ 5,908 แถว) → ชื่อทำให้เข้าใจผิด
--   → ตั้งตาม "แผนกเจ้าของ + สิ่งที่ทำ" (เหตุผลเดียวกับที่ user แยก 3 ฝั่งไว้ตามแผนกย่อย 2026-09-03)
--
-- ⚠️ ชื่อหมวดมี single source of truth ที่ `LOGISTIC_GROUPS` (src/utils/logisticSide.js) → App.jsx NAV_GROUP_ORDER
--    / DeptHub / PermissionsManagement อ้างตัวแปรนี้ · ไฟล์นี้ต้อง mirror ค่านั้นเป๊ะ (เทส navGroupsRegistry ล็อก)
-- ⚠️ cosmetic ล้วน — **ไม่แตะ role_permissions** สิทธิ์ทุก role คงเดิม
-- ⚠️ เปลี่ยนชื่อ = UPDATE แถวเดิม (PK `name`) → FK `permission_catalog_group_name_fkey` on update cascade
--    พา group_name ของทุกคีย์ในหมวดตามให้เอง · ห้าม insert ชื่อใหม่แล้วปล่อยชื่อเก่าค้าง (seq ชนกัน)

-- ① เปลี่ยนชื่อในทะเบียน (cascade ไป permission_catalog) — idempotent: ชื่อเก่าไม่มีแล้วก็ไม่ทำอะไร
update public.nav_groups set name = 'Logistic - Store (ป้อนของเข้าไลน์)',        updated_at = now() where name = 'Logistic - ขาเข้า (Inbound)';
update public.nav_groups set name = 'Logistic - Warehouse & Delivery (ส่งลูกค้า)', updated_at = now() where name = 'Logistic - ขาออก (Outbound)';

-- ② ทะเบียนเต็มชุด = NAV_GROUP_ORDER ณ 2026-09-07 (บรรทัดละหมวด · เทสอ่าน format นี้ ห้ามจัดใหม่)
insert into public.nav_groups (name, seq, sort_lo, sort_hi) values
  ('ภาพรวม',                                       1, 100, 149),
  ('จอแสดงผล',                                     2, 150, 199),
  ('ฝ่ายผลิต',                                      3, 200, 299),
  ('วิเคราะห์ & รายงาน',                            4, 300, 399),
  ('พนักงาน & ทักษะ',                               5, 400, 499),
  ('Logistic - Store (ป้อนของเข้าไลน์)',            6, 500, 519),
  ('Logistic - Warehouse & Delivery (ส่งลูกค้า)',   7, 520, 539),
  ('Logistic - แผนงาน & ข้อมูล',                    8, 540, 599),
  ('การตรวจสอบและซ่อมบำรุง',                        9, 600, 699),
  ('คุณภาพ & วิศวกรรม',                            10, 700, 799),
  ('ตั้งค่าโปรแกรม,ฐานข้อมูล',                     11, 900, 949),
  ('ผู้บริหาร & เดโม',                             12, 950, 999)
on conflict (name) do update
  set seq = excluded.seq, sort_lo = excluded.sort_lo, sort_hi = excluded.sort_hi, updated_at = now();

-- ── ตรวจหลังรัน ──
-- select seq, name from nav_groups order by seq;                                   -- 12 แถว ไม่มี 'ขาเข้า'/'ขาออก'
-- select group_name, count(*) from permission_catalog where group_name like 'Logistic%' group by 1;  -- Store=8 · W&D=2 · แผนงาน=1
-- select * from v_permission_catalog_sort_drift;                                   -- 0 แถว

-- Rollback (revert โค้ดฝั่งเว็บด้วย — ชื่อต้องตรง NAV_GROUP_ORDER เสมอ):
--   update nav_groups set name = 'Logistic - ขาเข้า (Inbound)'  where name = 'Logistic - Store (ป้อนของเข้าไลน์)';
--   update nav_groups set name = 'Logistic - ขาออก (Outbound)' where name = 'Logistic - Warehouse & Delivery (ส่งลูกค้า)';
