-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 🔐 ทะเบียนสิทธิ์ (/permissions) ไม่ตรงกับคีย์ที่โค้ดใช้จริง — audit 2026-11-18 (คำสั่ง user
--   *"audit หน้าการจัดการสิทธิ์ที เหมือนตอนนี้ไม่ได้อัพเดทตาม project"*)
--
-- ที่มา: หน้า /permissions อ่าน "รายการคีย์ให้ติ๊ก" จาก `permission_catalog` **ไม่ใช่** จากแถวใน
--   `role_permissions` ⇒ migration ที่ seed แถว role_permissions แล้วคิดว่า "role อื่น seed false ให้โผล่ในจอ"
--   (20261014e spare_master · 20261002 monitoring · 20260930 production_plan · 20261110 ppe)
--   ได้คีย์ที่**ใช้งานจริงแต่ตั้งจากจอไม่ได้เลย** — admin ต้องเขียน SQL เอง
--   วัดจริง 18/11: คีย์ที่โค้ด `can()`/`canSeeded()` เรียก 125 ตัว · ไม่อยู่ใน catalog 5 ตัว
--     · monitoring:manage        (Monitoring แผน-สต๊อก + ปุ่มอัพโหลดใน Planner & Sales)
--     · production_plan:write    (แผนล็อต + ความจุกะ + ลากแผนบนผัง)
--     · mtn_repair:spare_master  (ทะเบียนอะไหล่ — แยกจาก manage_master 14/10)
--     · ppe:manage               (ข้อกำหนด PPE รายหน่วย 10/11)
--     · org:manage               (ถูกถอดจาก catalog 06/08 ว่า "ไม่มีโค้ดเรียก" — แต่ 02/11 แผงมอบหมายรักษาการ
--                                 `OrgAssignmentsPanel` + RLS `org_assignments` กลับมาใช้คีย์นี้)
--   ⇒ เติม catalog อย่างเดียว **ไม่แตะค่าใน role_permissions** (ใครได้/ไม่ได้ เหมือนเดิมทุกคน)
--   sort: ช่วงต่อหมวดจาก `nav_groups` · เลือกเลขที่ยังว่าง (เช็ค `v_permission_catalog_sort_drift` ต้องว่าง)
--
-- + หัวหน้าส่วน (supervisor) กดยืนยัน/พักการเบิกชิ้นส่วนจากสโตร์ได้ (คำสั่ง user 18/11
--   *"การเบิกชิ้นส่วน หัวหน้าแผนก ทำไมไม่ได้ จะตั้งให้ทำได้ก็คลิกไม่ได้"*)
--   เดิม 31/08 ตั้งใจเว้น supervisor (§6.2 "หัวหน้ากลุ่มตัดสิน · หัวหน้าแผนกรับรู้") และเขียนไว้ว่า
--   "ถ้าหน้างานอยากให้ supervisor กดแทน → admin ติ๊กเพิ่มที่ /permissions" — วันนี้ user สั่งเปิดแล้ว
--   ขอบเขตแถว (ไลน์ไหน) ยังตัดสินด้วย writeScope/ไลน์ของตัวเองเหมือนเดิม คีย์นี้แค่ "มีปุ่มไหม"
--
-- ฝั่งโค้ดคอมมิทเดียวกัน: แท็บภาพรวม (matrix) คลิกสลับค่าได้ · ด่าน build
--   `permissionCatalogCoverage.test.mjs` = คีย์ที่โค้ดเรียกต้องมี catalog ใน migration ไม่งั้น build ล่ม
--
-- ย้อนกลับ (§R ท้ายไฟล์)

begin;

insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('production_plan', 'write',
   'วางแผนการผลิต: สร้าง/แก้/ยกเลิกแผนล็อต · ความจุกะ · ลากแผนบนผังไลน์',
   'ฝ่ายผลิต', 268),
  ('monitoring', 'manage',
   'Monitoring แผน-สต๊อก: อัพโหลด/แก้ตารางยอดยกมา-IN-OUT (รวมปุ่มอัพโหลดใน Planner & Sales)',
   'Logistic - Planning & Store (แผนงาน + ป้อนของเข้าไลน์)', 516),
  ('mtn_repair', 'spare_master',
   'MO ตั้งค่า · ทะเบียนอะไหล่ + ผังคลังอะไหล่ + รับเข้า/เบิก (ไม่แตะใบ MO — แยกจาก manage_master)',
   'การตรวจสอบและซ่อมบำรุง', 638),
  ('org', 'manage',
   'ผังองค์กร: จัดการทั้งผัง + มอบหมายรักษาการ/รับผิดชอบเพิ่ม (org_assignments)',
   'ตั้งค่าโปรแกรม,ฐานข้อมูล', 904),
  ('ppe', 'manage',
   'ข้อกำหนด PPE: ตั้งรายการ PPE ที่บังคับต่อส่วนงาน/แผนก/ไลน์/จุดงาน',
   'ตั้งค่าโปรแกรม,ฐานข้อมูล', 909)
on conflict (resource, action) do nothing;

-- supervisor กดเบิก/พักได้ (เดิมไม่มีแถว = จอภาพรวมขึ้น "–" ยังไม่เคยตั้ง)
insert into public.role_permissions (role, permission_key, allowed)
values ('supervisor'::public.user_role, 'wip_request:decide', true)
on conflict (role, permission_key) do update set allowed = excluded.allowed;

commit;

-- ── ตรวจผล ──
-- select resource||':'||action k, group_name, sort from permission_catalog
--  where (resource, action) in (('production_plan','write'),('monitoring','manage'),
--        ('mtn_repair','spare_master'),('org','manage'),('ppe','manage')) order by sort;   -- ต้องได้ 5 แถว
-- select * from v_permission_catalog_sort_drift;                                            -- ต้องว่าง
-- select role, allowed from role_permissions where permission_key = 'wip_request:decide' order by role;
--   -- ต้องมี supervisor=true

-- ── §R ย้อนกลับ ──
-- delete from public.permission_catalog
--  where (resource, action) in (('production_plan','write'),('monitoring','manage'),
--        ('mtn_repair','spare_master'),('org','manage'),('ppe','manage'));
--   (ลบแค่รายการในจอ — แถว role_permissions ไม่ถูกแตะ ใครได้/ไม่ได้เหมือนเดิม)
-- delete from public.role_permissions where role = 'supervisor' and permission_key = 'wip_request:decide';
