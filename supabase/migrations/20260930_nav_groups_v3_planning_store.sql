-- ═══ nav_groups v3: ยุบหมวด "แผนงาน & ข้อมูล" เข้า Store → "Planning & Store" (2026-09-30 · คำสั่ง user) ═══
-- Target project: MAIN "MAIN" (ewhdfqwfwofivojtsizn) — รันหลัง 20260907_nav_groups_v2_logistic_owner_names.sql
--
-- user: *"module แผนงานที่มี วางแผนผลิต กับ planner & sale รวมกับสโตร์ได้มั้ย เพราะคนใช้งานก็จะเป็น
--         หน่วยงานทีมเดียวกัน"* → "ลุยเลย"
--
-- วัดจริงก่อนยุบ (30/09):
--   · role ในระบบมี `planner_store` **role เดียว** สำหรับทั้งแผนงานและสโตร์ · ไม่มีใครถือ role `sale`
--   · คนที่ใช้งานจริงตั้ง `profiles.section = 'Planning&Store'` ทุกคน (แพลนนิ่ง · warehouse · billing)
--   ⇒ เดิมเมนูแยก 2 หมวด ทั้งที่องค์กรจริงเป็นหน่วยเดียว คนเดียวกันต้องสลับหมวดไปมาเอง
--
-- ⚠️ **Warehouse & Delivery ยังแยกเหมือนเดิม** — กติกา user 03/09 "Warehouse (FG 1xx) ≠ Store (2/3/5xx) ห้ามสลับ"
-- ⚠️ cosmetic ล้วน — **ไม่แตะ role_permissions** สิทธิ์ทุก role คงเดิม (คีย์ `demand:upload` แค่ย้ายหมวดที่แสดง)
-- ⚠️ ชื่อหมวดต้อง mirror `LOGISTIC_GROUPS` (src/utils/logisticSide.js) เป๊ะ — เทส navGroupsRegistry ล็อก
-- ⚠️ FK `permission_catalog_group_name_fkey` = on update CASCADE / on delete RESTRICT
--    ⇒ เปลี่ยนชื่อ = UPDATE (พาคีย์ตามให้) · ลบหมวดได้ต่อเมื่อย้ายคีย์ออกหมดแล้วเท่านั้น

-- ① เปลี่ยนชื่อหมวด Store (cascade ไป permission_catalog 8 คีย์) — idempotent
update public.nav_groups set name = 'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', updated_at = now()
 where name = 'Logistic - Store (ป้อนของเข้าไลน์)';

-- ② ย้ายคีย์เดียวของหมวดแผนงาน (`demand:upload`) เข้าหมวดใหม่ · sort 510 = ช่องว่างถัดจาก 502–509 ในช่วง 500–519
update public.permission_catalog
   set group_name = 'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', sort = 510, updated_at = now()
 where group_name = 'Logistic - แผนงาน & ข้อมูล';

-- ③ ลบหมวดแผนงานที่ว่างแล้ว (ถ้ายังมีคีย์ค้าง FK จะ RESTRICT ⇒ migration ล้มทั้งก้อน ไม่มีหมวดกำพร้า)
delete from public.nav_groups where name = 'Logistic - แผนงาน & ข้อมูล';

-- ④ ทะเบียนเต็มชุด = NAV_GROUP_ORDER ณ 2026-09-30 (บรรทัดละหมวด · เทสอ่าน format นี้ ห้ามจัดใหม่)
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
  ('ตั้งค่าโปรแกรม,ฐานข้อมูล',                                   10, 900, 949),
  ('ผู้บริหาร & เดโม',                                           11, 950, 999)
on conflict (name) do update
  set seq = excluded.seq, sort_lo = excluded.sort_lo, sort_hi = excluded.sort_hi, updated_at = now();

-- ── ตรวจหลังรัน (MAIN) ──
-- select seq, name from nav_groups order by seq;                                               -- 11 แถว ไม่มี 'แผนงาน & ข้อมูล'
-- select group_name, count(*) from permission_catalog where group_name like 'Logistic%' group by 1;  -- Planning & Store=9 · W&D=2
-- select * from v_permission_catalog_sort_drift;                                               -- 0 แถว

-- ── Rollback (MAIN · revert โค้ดฝั่งเว็บด้วย — ชื่อต้องตรง NAV_GROUP_ORDER เสมอ) ──
--   insert into nav_groups (name, seq, sort_lo, sort_hi) values ('Logistic - แผนงาน & ข้อมูล', 8, 540, 599);
--   update permission_catalog set group_name = 'Logistic - แผนงาน & ข้อมูล', sort = 542
--    where resource = 'demand' and action = 'upload';
--   update nav_groups set name = 'Logistic - Store (ป้อนของเข้าไลน์)'
--    where name = 'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)';
--   แล้วรัน ④ ของ 20260907_nav_groups_v2_logistic_owner_names.sql ซ้ำเพื่อคืน seq เดิม
