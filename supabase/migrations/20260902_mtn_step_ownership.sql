-- ═══════════════════════════════════════════════════════════════════════════
-- ใบแจ้งซ่อม MO — จัดสิทธิ์ให้ตรงกับ "ใครทำขั้นไหน" จริง   Target: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา (คำสั่ง user 2026-09-02 · ไล่ทีละขั้นตามที่หน้างานทำจริง):
--   1 เปิดใบ            → ใครก็ได้ (ส่วนใหญ่หัวหน้าไลน์ฝ่ายผลิต)
--   2 รับงาน/จ่ายงาน     → หัวหน้าช่าง
--   3 ลงมือซ่อม/อัพเดท   → ทีมช่างที่ไปทำ
--   4 ตรวจรับงานหลังซ่อม → **คนที่เปิดใบแจ้งซ่อม**
--   5 ตรวจคุณภาพ        → QA
--   6 รับมอบ/ติดตามผล    → หัวหน้าแผนกของฝ่ายที่แจ้ง
--   7 อนุมัติปิด         → หัวหน้าแผนก/ส่วน/ผจก. ของฝ่ายที่แจ้ง
--
-- สภาพเดิมที่ตรวจเจอ (STEP_PERM = {2:service, 3:service, 4:service, 5:qa, 6:report, 7:approve}):
--   🔴 ขั้น 4 ใช้ `service` = **ทีมช่างชุดเดียวกับที่เพิ่งซ่อม ตรวจงานตัวเองแล้วเซ็นรับรองเอง**
--      และช่องติ๊ก "เกี่ยวกับคุณภาพ?" ก็อยู่ขั้นนี้ ⇒ ช่างเลือกเองว่าจะให้ QA ตรวจไหม
--   🔴 ขั้น 6 ใช้ `report` ซึ่ง seed ด้วย enum_range = true **ทุก role**
--      ⇒ sale / planner_store / display กดรับมอบ + ให้คะแนนความพึงพอใจแทนฝ่ายที่แจ้งได้
--   ⚠️ ขั้น 7 `approve` = admin/manager เท่านั้น → supervisor (ระดับส่วน) ทำไม่ได้
--   ⚠️ ขั้น 2 กับ 3 ใช้คีย์เดียวกัน → ช่างรับงานแล้วจ่ายงานให้ตัวเองได้ แยกไม่ได้
--   ⚠️ bucket `dept_admin` เกิด 2026-08-03 หลังคีย์ mtn_repair ถูก seed (2026-07-14)
--      ⇒ ไม่มีแถวเลยสักคีย์ = แอดมินหน่วยงานไม่ได้อะไรเพิ่มในโมดูลนี้ (กับดัก enum_range)
--
-- สิ่งที่ไฟล์นี้ทำ:
--   ① คีย์ใหม่ 3 ตัว  assign (ขั้น 2) · accept_work (ขั้น 4) · handover (ขั้น 6)
--   ② เพิ่ม supervisor + dept_admin เข้า approve (ขั้น 7)
--   ③ แก้ label ทุกคีย์ให้บอกชัดว่า "ขั้นไหน ใครทำ" (ของเดิมคลุมเครือ เช่น
--      'แจ้งซ่อม MO (step 1) + รับมอบ/ติดตาม (step 6)' = คีย์เดียวคุม 2 ขั้นคนละฝ่าย)
--   ④ เรียง sort ตามลำดับขั้น 1→7 (เดิมสลับกันจนอ่านตารางแล้วไล่ลำดับงานไม่ออก)
--
-- ⚠️ seed แบบ **ระบุ role ชัดเจน ห้าม enum_range** (กับดักที่โปรเจคโดนมาแล้วหลายรอบ)
-- ⚠️ ฝั่งโค้ดถอยกลับคีย์เดิมอัตโนมัติจนกว่าไฟล์นี้จะถูกรัน (isActionSeeded ใน canDoStep)
--    → deploy โค้ดก่อนรัน SQL ได้ ไม่มีใครทำงานไม่ได้ระหว่างรอ
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① ทะเบียนสิทธิ์ (permission_catalog) — ไม่ลงที่นี่ = admin ปรับจาก /permissions ไม่ได้ ──
insert into permission_catalog (resource, action, label, group_name, sort) values
  ('mtn_repair', 'report',           'MO ขั้น 1 · เปิดใบแจ้งซ่อม (ใครก็ได้ที่พบปัญหา)',                'การตรวจสอบและซ่อมบำรุง', 605),
  ('mtn_repair', 'assign',           'MO ขั้น 2 · รับเรื่อง + จ่ายงานให้ช่าง (หัวหน้าช่าง)',            'การตรวจสอบและซ่อมบำรุง', 606),
  ('mtn_repair', 'service',          'MO ขั้น 3 · ลงมือซ่อม + อัพเดทผล/อะไหล่ (ช่างที่รับงาน)',         'การตรวจสอบและซ่อมบำรุง', 607),
  ('mtn_repair', 'service_own_team', 'MO ขั้น 2-3 · จ่ายงาน+ซ่อม เฉพาะใบของทีมตัวเอง',                 'การตรวจสอบและซ่อมบำรุง', 608),
  ('mtn_repair', 'accept_work',      'MO ขั้น 4 · ตรวจรับงานหลังซ่อม (ฝ่ายที่แจ้ง — ผู้เปิดใบทำได้เสมอ)', 'การตรวจสอบและซ่อมบำรุง', 609),
  ('mtn_repair', 'qa',               'MO ขั้น 5 · ตรวจคุณภาพหลังซ่อม (QA)',                            'การตรวจสอบและซ่อมบำรุง', 610),
  ('mtn_repair', 'handover',         'MO ขั้น 6 · รับมอบ + ติดตามผล (หัวหน้าแผนกของฝ่ายที่แจ้ง)',       'การตรวจสอบและซ่อมบำรุง', 611),
  ('mtn_repair', 'approve',          'MO ขั้น 7 · อนุมัติปิดใบ (หัวหน้าแผนก/ส่วน/ผจก. ฝ่ายที่แจ้ง)',    'การตรวจสอบและซ่อมบำรุง', 612),
  ('mtn_repair', 'manage_master',    'MO ตั้งค่า · ช่าง/อะไหล่/ข้อมูลตั้งต้น + แก้ย้อนหลังได้ทุกขั้น',    'การตรวจสอบและซ่อมบำรุง', 613),
  ('mtn_repair', 'delete',           'MO · ลบใบแจ้งซ่อมทิ้ง',                                          'การตรวจสอบและซ่อมบำรุง', 614)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

-- ── ② ขั้น 2: จ่ายงาน (แยกจากขั้น 3 ที่เป็นการลงมือซ่อม) ────────────────────────
--    seed `mtn` ไว้ก่อนเพื่อไม่ให้ทีมช่างทำงานไม่ได้ตอน deploy
--    ⚠️ อยากรัดให้ "เฉพาะหัวหน้าช่าง" จริง: ถอด mtn ออกที่ /permissions แล้วติ๊ก
--       "แอดมินหน่วยงาน" (profiles.is_dept_admin) ให้หัวหน้าช่างที่ /add-user
--       — แกน "หัวหน้าช่าง vs ช่าง" ใช้ flag ที่มีอยู่แล้ว ห้ามเพิ่ม role ใหม่
insert into role_permissions (role, permission_key, allowed)
select r.role, 'mtn_repair:assign', r.role::text = any (array['admin','manager','mtn','dept_admin'])
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── ③ ขั้น 4: ตรวจรับงานหลังซ่อม — ฝั่งผู้แจ้ง ไม่ใช่ช่าง ───────────────────────
--    **ไม่ให้ role `mtn`/`qa`** โดยตั้งใจ (ช่างตรวจรับงานตัวเองไม่ได้)
--    ผู้เปิดใบทำได้เสมอผ่านโค้ด (เทียบ mtn_orders.reported_by_name) ไม่ต้องรอ admin ติ๊ก
--    → ช่างที่เปิดใบเองก็ยังตรวจรับใบของตัวเองได้ตามปกติ
insert into role_permissions (role, permission_key, allowed)
select r.role, 'mtn_repair:accept_work', r.role::text = any (array['admin','manager','supervisor','leader','dept_admin'])
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── ④ ขั้น 6: รับมอบ/ติดตามผล — หัวหน้าแผนกของฝ่ายที่แจ้ง ──────────────────────
--    เดิมใช้ `report` (ทุก role) → ตัดเหลือระดับหัวหน้า + ผู้เปิดใบ (ผ่านโค้ด)
insert into role_permissions (role, permission_key, allowed)
select r.role, 'mtn_repair:handover', r.role::text = any (array['admin','manager','supervisor','leader','dept_admin'])
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── ⑤ ขั้น 7: อนุมัติปิด — เพิ่มหัวหน้าส่วน (supervisor) + แอดมินหน่วยงาน ────────
--    ⚠️ update เฉพาะ role ที่ต้อง "เปิดเพิ่ม" — ห้ามเขียนทับทั้งคอลัมน์
--       (ถ้า admin เคยไปปิดของ role ไหนไว้เอง ต้องไม่โดนรีเซ็ต)
insert into role_permissions (role, permission_key, allowed)
select r.role, 'mtn_repair:approve', true
from (select unnest(enum_range(null::user_role)) as role) r
where r.role::text = any (array['admin','manager','supervisor','dept_admin'])
on conflict (role, permission_key) do update set allowed = true;

-- ── ⑥ ปิดช่องว่าง bucket dept_admin ของคีย์เดิม (เกิดหลัง seed ชุดแรก) ──────────
--    แอดมินหน่วยงาน = หัวหน้าหน่วยงาน → ควรเปิดใบ/ตรวจคุณภาพในหน่วยงานตัวเองได้
--    (ไม่แจก service/manage_master/delete — นั่นเป็นของทีมช่าง/ผู้ดูแลระบบ)
insert into role_permissions (role, permission_key, allowed) values
  ('dept_admin', 'mtn_repair:report', true),
  ('dept_admin', 'mtn_repair:qa',     true)
on conflict (role, permission_key) do nothing;

-- ═══ ตรวจผลหลังรัน ═══════════════════════════════════════════════════════════
-- ① ทะเบียนเรียงตามลำดับขั้น 1→7 (ควรได้ 10 แถว sort 605-614 ไม่ซ้ำ):
--   select action, sort, label from permission_catalog
--    where resource = 'mtn_repair' order by sort;
--
-- ② ใครทำขั้นไหนได้บ้าง (ควรเห็น mtn ไม่มีในบรรทัด accept_work/handover):
--   select replace(permission_key,'mtn_repair:','') as step_key,
--          string_agg(role::text, ', ' order by role) as roles
--     from role_permissions
--    where permission_key like 'mtn_repair:%' and allowed
--    group by 1 order by 1;
--
-- ③ ต้องไม่มี sort ชนกันในหมวดนี้ (ควรได้ 0 แถว):
--   select sort, count(*) from permission_catalog
--    where group_name = 'การตรวจสอบและซ่อมบำรุง' group by 1 having count(*) > 1;
