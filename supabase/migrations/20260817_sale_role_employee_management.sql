-- ============================================================================
-- W/H + Store จัดการพนักงานของหน่วยงานตัวเองได้ (2026-08-17)
--
-- ที่มา: บัญชีคลัง/สโตร์ — warehouse1@tsat4, warehouse2@tsat4, planningstore@tsat4
--   ถือ role `sale` ซึ่ง **ไม่มีแถว `page:/operator` / `page:/register` เลย**
--   → fail-closed = เปิดหน้าฐานข้อมูลพนักงาน/ลงทะเบียนไม่ได้ตั้งแต่แรก
--   (คนละเรื่องกับบั๊ก RLS ของ employee_skills ที่แก้ใน 20260817_employee_skills_rls_data_driven)
--
-- โจทย์จากผู้ใช้: "เห็นของคนอื่นไม่เท่าไหร่ กลัวลบหรือแก้ผิด"
--   → คุมที่ **สิทธิ์เขียนรายแถว** ไม่ใช่การมองเห็น
--
-- ⚠️ ทำไมไม่ใช้ `profiles.sections` (scope ปกติของระบบ) มาจำกัด:
--   ผังมี section 'Planning&Store' อยู่จริง แต่ **ไม่มีไลน์ผลิตไหนสังกัดส่วนงานนี้**
--   `sections` เป็น scope ระดับทั้งระบบ → ตั้งเมื่อไหร่ หน้าที่กรองด้วย section
--   (StoreMonitor · PlannerSales · RundownStock · Dashboard · Report) เหลือ 0 แถวทันที
--   = พังงานประจำวันของบัญชีคลัง/สโตร์เอง แลกกับการซ่อนรายชื่อพนักงานฝ่ายผลิต
--   ผู้ใช้บอกเองว่า "เห็นของคนอื่นไม่เท่าไหร่" → จึงคงการมองเห็นไว้ แล้วล็อกที่ปุ่มแก้แทน
--
-- ── ส่วนที่ 1: เปิดหน้าให้ role `sale` ──────────────────────────────────────
--   page:/operator · page:/register · employees:register · employees:edit · skills:edit
--   (ชุดเดียวกับที่ `planner_store` ถืออยู่แล้ว + skills:edit)
--   ไม่ seed `employees:deactivate` — การปิดใช้งานพนักงานเป็นงานของหัวหน้าส่วนงาน
--   ต้องการเพิ่มทีหลังติ๊กที่ /permissions ได้เลย ไม่ต้อง deploy
--
-- ── ส่วนที่ 2: คีย์ใหม่ `employees:edit_all_sections` ────────────────────────
--   role ที่ "มี"    → แก้พนักงานได้ทุกส่วนงาน (พฤติกรรมเดิมของระบบ)
--   role ที่ "ไม่มี" → ปุ่ม ✏️ / 🚫 / แผงระดับทักษะ เปิดเฉพาะแถวที่ section ตรงกับ
--                     ส่วนงานของตัวเอง (profiles.section) แถวอื่นขึ้นไอคอน 🔒
--   seed ให้ทุก role ที่เคยแก้ได้ = true → **พฤติกรรมเดิมไม่เปลี่ยนสำหรับใครเลย**
--   ยกเว้น `sale` = false (ตัวที่เพิ่งได้สิทธิ์ใหม่ในไฟล์นี้)
--   โค้ดฝั่ง UI ใช้ isActionSeeded() → ก่อน apply migration นี้ = ทุก role แก้ได้หมด
--   (pattern เดียวกับ canDelete() ใน src/utils/permissions.js)
--
-- ⚠️ ข้อจำกัดที่ต้องรู้: เป็นการกันพลาดฝั่ง UI — RLS ระดับ DB ยังไม่รู้จัก section
--    ของพนักงาน (policy ของ employees เป็น `true` สำหรับ authenticated มาแต่เดิม)
--    เหมาะกับโจทย์ "กันแก้ผิดตัว" ไม่ใช่การกันผู้ใช้ที่ตั้งใจยิง API ตรง
--    ถ้าต้องการระดับ DB จริง ต้องเขียน policy ที่ join section ของแถวกับ profiles ของผู้เรียก
--
-- ── ส่วนที่ 3: ตั้งส่วนงานของบัญชีคลัง/สโตร์ ────────────────────────────────
--   set profiles.section = 'Planning&Store' (คอลัมน์เดี่ยว) — ใช้ตอบว่า "ส่วนงานของฉันคือ"
--   ⚠️ ไม่แตะ profiles.sections (ยังว่าง) โดยตั้งใจ — effectiveSections() กติกาข้อ 5
--      "role อื่นที่มีแค่ section เดี่ยว → ไม่จำกัด" → scope ทั้งระบบคงเดิมเป๊ะ
--      (ห้ามเผลอย้ายค่านี้ไปใส่ sections[] จะพังหน้า Store/Planner ตามที่อธิบายข้างบน)
--
-- ROLLBACK:
--   delete from role_permissions where role='sale'::user_role and permission_key in
--     ('page:/operator','page:/register','employees:register','employees:edit','skills:edit');
--   delete from role_permissions where permission_key = 'employees:edit_all_sections';
--   update profiles set section = null
--     where id in (select id from auth.users where email in
--       ('warehouse1@tsat4','warehouse2@tsat4','planningstore@tsat4'));
-- ============================================================================

-- ── 1. เปิดหน้า/ปุ่มให้ role sale ─────────────────────────────────────────────
insert into public.role_permissions (role, permission_key, allowed)
select 'sale'::user_role, k, true
from unnest(array[
  'page:/operator',
  'page:/register',
  'employees:register',
  'employees:edit',
  'skills:edit'
]) as k
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── 2. คีย์ควบคุม "แก้ข้ามส่วนงานได้ไหม" ─────────────────────────────────────
-- ⚠️ ไม่ใช้ enum_range() ไล่ทุก role — กับดักที่เอกสารเตือนไว้ (role ที่เพิ่มทีหลังจะไม่มีแถว)
--    ที่นี่ระบุรายชื่อชัดเจนแทน เพราะ default ที่ปลอดภัยของคีย์นี้คือ "true = เหมือนเดิม"
--    role ใหม่ที่ยังไม่มีแถว → can() = false → ถูกจำกัดตามส่วนงาน (fail-safe ฝั่งแคบกว่า)
--    ถ้าเพิ่ม role ใหม่ที่ต้องแก้ข้ามส่วนงาน อย่าลืมติ๊กที่ /permissions
insert into public.role_permissions (role, permission_key, allowed)
select r::user_role, 'employees:edit_all_sections', true
from unnest(array['admin','manager','supervisor','leader','mtn','planner_store','dept_admin']) as r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role, permission_key, allowed)
select r::user_role, 'employees:edit_all_sections', false
from unnest(array['sale','qa','document_control','engineer','display']) as r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── 3. ส่วนงานของบัญชีคลัง/สโตร์ (คอลัมน์เดี่ยว ไม่แตะ sections[]) ────────────
update public.profiles p
set section = 'Planning&Store'
from auth.users u
where u.id = p.id
  and u.email in ('warehouse1@tsat4', 'warehouse2@tsat4', 'planningstore@tsat4');
