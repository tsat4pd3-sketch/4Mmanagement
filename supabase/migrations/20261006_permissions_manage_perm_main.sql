-- ════════════════════════════════════════════════════════════════════════════
-- /permissions — ให้ UI กับ DB อ่าน "คีย์เดียวกัน" (QC audit 2026-10-06)
-- Project: MAIN (ewhdfqwfwofivojtsizn)  ← ห้ามรันฝั่ง Product DB (DR)
--
-- ปัญหาที่แก้ (วัดจริง 06/10):
--   · `src/pages/PermissionsManagement.jsx` **ไม่เช็คสิทธิ์ผู้ที่เปิดดูเลย**
--     (grep UserContext|can( = 0) — ประตูเดียวคือ `page:/permissions` ซึ่ง**ติ๊กให้ role อื่นได้
--     จากจอนั้นเอง** ⇒ คนที่ได้คีย์นั้นเห็น matrix ที่ติ๊กได้ทุกช่อง
--   · policy ของ `role_permissions` hardcode `profiles.role = 'admin'` (ไม่ใช่ `has_perm`)
--     ⇒ **ประตู UI ≠ ประตู DB** · กดแก้แถวที่มีอยู่แล้ว = RLS ปฏิเสธ = "0 แถว ไม่มี error"
--     (กฎเหล็ก DB ข้อ 2) ⇒ ช่องติ๊กเปลี่ยนบนจอ แต่ฐานไม่เปลี่ยน ไม่มี toast แดง = **จอโกหก**
--     เรื่อง "ใครมีสิทธิ์อะไร" ซึ่งเป็นข้อมูลที่ทุกจอในระบบพึ่ง
--   · คอมเมนต์ใน `20260806_permission_catalog_gaps.sql` เขียนว่า "/permissions คุมด้วย
--     page:/permissions (admin เท่านั้น)" — **สมมติฐานหมดอายุ** (กฎเหล็ก DB ข้อ 10)
--
-- สิ่งที่ทำ:
--   (1) คืนคีย์ `permissions:manage` เข้าทะเบียน (ถูกลบไป 06/08 · แถวใน role_permissions คงอยู่)
--   (2) **บังคับ allowed = false ทุก role ที่ไม่ใช่ admin** สำหรับคีย์นี้ — กันแถวค้างจากอดีต
--       และกัน bucket `dept_admin` ใน has_perm() แจกคีย์นี้ให้โดยไม่มีใครเจตนา
--   (3) เปลี่ยน policy เขียนของ `role_permissions` จาก role array → `has_perm('permissions:manage')`
--
-- 🔒 พฤติกรรมวันที่ apply = **เท่าเดิมเป๊ะ** (admin เท่านั้นที่เขียนได้)
--    `has_perm()` มี admin bypass อยู่ในตัว ⇒ admin ไม่ต้องพึ่งแถวใน role_permissions
--    ต่างกันแค่ "ตอนนี้ admin ตั้งใจแจกให้ role อื่นได้ แล้ว DB จะยอมรับจริง" (เดิมแจกแล้วเขียนไม่ติด)
--
-- ย้อนกลับ (ไม่เสียข้อมูล — ดูบล็อก ROLLBACK ท้ายไฟล์)
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) คืนคีย์เข้าทะเบียน (รายการที่โผล่ให้ติ๊กที่ /permissions) ──────────────
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('permissions', 'manage', 'จัดการสิทธิ์: แก้ไขตารางสิทธิ์', 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 90)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

-- ── (2) admin เท่านั้น — ปิดทุก role อื่นแบบชัดเจน ────────────────────────────
-- ทำไมต้องปิดชัด: has_perm() มี bucket `dept_admin` ที่แจก action ที่ไม่ใช่ `page:*` ให้
-- โดยอ่านจากแถว role='dept_admin' ⇒ ถ้ามีแถวค้าง allowed=true จากอดีต การสลับ policy
-- จะกลายเป็น "ยกระดับสิทธิ์โดยไม่มีใครเจตนา" ⇒ เขียนให้ false ไว้ก่อนเสมอ
update public.role_permissions
   set allowed = false
 where permission_key = 'permissions:manage'
   and role <> 'admin'::user_role
   and allowed;

insert into public.role_permissions (role, permission_key, allowed)
values ('admin'::user_role, 'permissions:manage', true)
on conflict (role, permission_key) do update set allowed = true;

-- ── (3) policy เขียน: อ่านคีย์เดียวกับปุ่มบนจอ ────────────────────────────────
drop policy if exists role_permissions_write_admin on public.role_permissions;
drop policy if exists role_permissions_write_perm  on public.role_permissions;
create policy role_permissions_write_perm on public.role_permissions
  for all to authenticated
  using       ((select public.has_perm('permissions:manage')))
  with check  ((select public.has_perm('permissions:manage')));

comment on policy role_permissions_write_perm on public.role_permissions is
  'คีย์เดียวกับปุ่มบนจอ /permissions (permissions:manage) — ห้ามกลับไป hardcode role array '
  'เพราะ role array มือจะแคบกว่าสิทธิ์ที่ /permissions แจกเสมอ ⇒ คนมีปุ่มแต่เขียนได้ 0 แถวเงียบ';

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ apply แล้ว 2026-10-09 (ผ่าน MCP) — แต่ **เหลือ 1 บรรทัดที่ต้องรันมือ**
--    วัดกลับได้: in_catalog = 1 · role_permissions = admin/true เท่านั้น (role อื่น false)
--    · policy ใหม่ `role_permissions_write_perm` สร้างแล้ว
--
-- 🔴 กับดักเครื่องมือ (คนถัดไปจะเจอซ้ำ): **MCP `execute_sql`/`apply_migration` รัน
--    `drop policy` ไม่ได้** — คำสั่งที่ถูกตีว่า "ทำลาย" จะรอ user ยืนยันแล้วค้างจน
--    timeout 60s (ไม่ใช่ lock — `pg_stat_activity` วัดได้ blocked = 0 · ทั้งก้อนถูก
--    rollback สะอาด ไม่มีสถานะครึ่งๆ) ⇒ **ก้อนที่มี drop ต้องส่ง SQL ให้ user รันเอง**
--    และ MCP รับ DDL ได้ **ทีละ statement** เท่านั้น (ก้อนรวมหลาย statement ก็ค้างเหมือนกัน)
--
-- ⚠️ สถานะตอนนี้ = policy เขียน 2 ตัวอยู่ร่วมกัน (`_write_admin` เก่า + `_write_perm` ใหม่)
--    policy ของ cmd เดียวกันถูก **OR** กัน ⇒ ผลลัพธ์ = `has_perm('permissions:manage')`
--    ซึ่งครอบ admin อยู่แล้ว ⇒ **พฤติกรรมถูกต้องแล้ววันนี้ ไม่มีช่องโหว่** ตัวเก่าแค่ซ้ำซ้อน
--    แต่ขัดกฎ "ห้าม hardcode role array ใน policy" ⇒ ให้ user รันบรรทัดนี้เพื่อปิดงาน:
--      drop policy if exists role_permissions_write_admin on public.role_permissions;
--    (ตรวจกลับ: ต้องเหลือ role_permissions_select + role_permissions_write_perm)
-- ════════════════════════════════════════════════════════════════════════════

-- ── ตรวจกลับหลังรัน (ควรได้: 1 แถว admin/true · policy ชื่อ role_permissions_write_perm) ──
--   select role, allowed from public.role_permissions
--    where permission_key = 'permissions:manage' order by role;
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--     from pg_policy where polrelid = 'public.role_permissions'::regclass;
--   select count(*) as in_catalog from public.permission_catalog
--    where resource = 'permissions' and action = 'manage';

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (คืน policy เดิมแบบ hardcode admin · ไม่ลบข้อมูลใด)
-- ────────────────────────────────────────────────────────────────────────────
--   drop policy if exists role_permissions_write_perm on public.role_permissions;
--   create policy role_permissions_write_admin on public.role_permissions
--     for all to authenticated
--     using (exists (select 1 from profiles
--             where profiles.id = auth.uid() and profiles.role = 'admin'::user_role))
--     with check (exists (select 1 from profiles
--             where profiles.id = auth.uid() and profiles.role = 'admin'::user_role));
--   delete from public.permission_catalog
--    where resource = 'permissions' and action = 'manage';
--   -- (แถวใน role_permissions คงไว้ได้ — ไม่มีใครอ่านเมื่อคีย์ไม่อยู่ในทะเบียน)
-- ════════════════════════════════════════════════════════════════════════════
