-- ปิดช่องแก้ "ค่าแรงมาตรฐานทั้งโรงงาน" และ "ผู้เซ็นใบค่าฝีมือ" โดยไม่มีด่าน — full QC audit 2026-09-03 (Main)
--
-- 🔴 ที่มา: แผง 💰 Activity Rate และ ✍️ ผู้เซ็นใบค่าฝีมือ ใน /org-setup
--    **ไม่มี can() สักบรรทัดเดียว** และ RLS ทั้ง 2 ตารางเป็น using(true)/with check(true)
--
--    เหตุผลที่มันหลุด — สมมติฐานที่หมดอายุแล้ว:
--    คอมเมนต์ในโค้ด (2026-08-11) เขียนไว้ว่า "หน้า /org-setup เป็น admin-only อยู่แล้ว
--    (page:/org-setup seed แค่ admin) ไม่ต้องเพิ่ม gate ซ้ำ" — **จริง ณ ตอนนั้น**
--    แต่ 2026-08-24 migration `20260824_org_manage_own_unit.sql` เปิดหน้าให้ role สนับสนุน
--    "ดูผังของตัวเอง" แล้ว **ไม่มีใครกลับมาปิดแผงที่พึ่งสมมติฐานเดิม**
--    (คลาสเดียวกับ protect_profile_role ที่กัน `role` ไว้ตัวเดียว แล้วมีคนเพิ่มแกนสิทธิ์ทีหลัง)
--
-- 🧪 วัดกับฐานจริง 2026-09-03:
--    page:/org-setup = true → admin · engineer · mtn · planner_store · sale (+ bucket dept_admin ที่ปลด page ไม่ได้)
--    = **บัญชีจริง 16 คน** เข้าหน้านี้ได้ และแก้ได้ทั้ง 2 แผงโดยไม่มีอะไรกั้น
--
--    ผลถ้าแก้: `cost_center_rates` 52 cost center = ตัวคูณของ "เงินที่ประหยัดได้" ทั้งระบบ
--      (/improvements cost saving · มูลค่าดาวไทม์ · มูลค่าของเสีย · เด็ค Monthly Review ผู้บริหาร)
--      แก้เลขเดียว = ตัวเลขเงินทั้งโรงงานเปลี่ยนตาม โดยไม่มีใครสังเกต
--    `section_signers` = ชื่อที่ถูกพิมพ์ลงช่องลายเซ็น "ใบสรุปค่าฝีมือ" อัตโนมัติ
--      แก้ = เอกสารที่พิมพ์ออกไปอ้างผู้อนุมัติผิดคน
--
-- ⚠️ ตั้งใจไม่ปิดหน้า /org-setup กลับเป็น admin-only — การเปิดให้หน่วยงานดู/แก้ผังของตัวเอง
--    เป็นสิ่งที่ user สั่งไว้ 2026-08-24 (แอดมินหน่วยงานเพิ่มแผนกตัวเองไม่ได้ = ทางตัน)
--    ที่ต้องแก้คือ "แผงที่ไม่ควรเปิดตามไปด้วย" ไม่ใช่ถอยทั้งหน้า

-- ═══ ① คีย์ใหม่: แก้ Activity Rate (ค่าแรง/ค่าเสื่อม/โสหุ้ย ต่อ cost center) ═══
-- seed แบบ **ระบุ role ตรงตัว ห้าม enum_range** (กับดักเดิม: role ที่เพิ่มทีหลังไม่มีแถว)
-- ให้ admin + manager เท่านั้น — เป็นตัวเลขจากบัญชี (SAP) ระดับบริษัท ไม่ใช่ข้อมูลของหน่วยงานใด
-- ไม่ให้ bucket dept_admin: dept_admin เป็น tier "ของหน่วยงานตัวเอง" แต่ rate เป็นของทั้งโรงงาน
insert into public.permission_catalog (resource, action, label, group_name, sort)
values ('cost_rate', 'manage', 'แก้ Activity Rate (ค่าแรง/ชม. ต่อ cost center)', 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 941)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

insert into public.role_permissions (role, permission_key, allowed)
select r::user_role, 'cost_rate:manage', true
from unnest(array['admin', 'manager']) as r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- role ที่เหลือ = ปิดชัดเจน (ไม่ปล่อยให้ "ไม่มีแถว" ซึ่งอ่านยากตอน audit)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'cost_rate:manage', false
from unnest(enum_range(null::user_role)) as r
where r::text not in ('admin', 'manager')
on conflict (role, permission_key) do nothing;

-- ═══ ② RLS แบบ data-driven (กฎเหล็ก: policy ห้าม hardcode role array) ═══
-- ⚠️ UI อย่างเดียวไม่พอ — RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว" ไม่ error
--    ฝั่ง client จึงต้องนับแถวที่เขียนจริงด้วย (.select('id')) ตามกฎ RLS-เงียบ
drop policy if exists cost_center_rates_write on public.cost_center_rates;
create policy cost_center_rates_write on public.cost_center_rates
  for all to authenticated
  using (public.has_perm('cost_rate:manage'))
  with check (public.has_perm('cost_rate:manage'));
-- อ่านได้ทุกคนเหมือนเดิม (หน้า /improvements ต้องอ่าน rate มาคิด cost saving)

-- ผู้เซ็นใบค่าฝีมือ: ใช้คีย์ที่มีอยู่แล้ว **ไม่เพิ่มคีย์ใหม่**
--   `org:manage_own_unit` (admin + bucket dept_admin) — ฝั่ง UI จำกัดต่อว่าเป็น "ส่วนงานของตัวเอง"
--   (RLS จำกัดรายแถวตาม profiles.section ไม่ได้ เพราะ section เป็นข้อความอิสระ ไม่ใช่ FK)
drop policy if exists section_signers_insert on public.section_signers;
drop policy if exists section_signers_update on public.section_signers;
drop policy if exists section_signers_delete on public.section_signers;
create policy section_signers_write on public.section_signers
  for all to authenticated
  using (public.has_perm('org:manage_own_unit'))
  with check (public.has_perm('org:manage_own_unit'));

comment on table public.cost_center_rates is
  'Activity rate ต่อ cost center (บาท/ชม.) — เขียนได้เฉพาะผู้ถือ cost_rate:manage (audit 2026-09-03)';
