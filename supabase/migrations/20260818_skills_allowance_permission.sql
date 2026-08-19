-- ============================================================================
-- ใบเซอร์ค่าฝีมือ (allowance skill) — ต้องระดับหัวหน้าแผนกขึ้นไป (2026-08-18 · คำสั่ง user)
--
-- ที่มา: user สั่ง "ค่าฝีมือ ต้องหัวหน้าแผนก" แล้วยืนยันให้คุมด้วย **role** (ไม่ใช่ profiles.position)
--   ใบเซอร์ค่าฝีมือ = มี/ไม่มี ใช้ตัดสิน "สิทธิ์ค่าฝีมือ" ซึ่งกระทบเงิน → ต้องแคบกว่าการแก้คะแนนทั่วไป
--   (`skill_definitions.category = 'allowance_skill'` · ติ๊กแล้วระบบเก็บ score = 100)
--
-- ── กลไก: permission key ใหม่ `skills:edit_allowance` ───────────────────────
--   ระดับหัวหน้าแผนกขึ้นไป = admin / manager / supervisor (+ bucket dept_admin)
--   ตำแหน่ง `dept_head` ในระบบ map เป็น level `supervisor` (ดู POSITION_LEVELS ใน src/utils/positions.js)
--   ปรับผู้ถือได้ที่ /permissions มีผลทั้ง UI และ RLS ทันที ไม่ต้อง deploy
--
-- ⚠️ role ที่เสียสิทธิ์นี้ไปเทียบกับเดิม: leader, mtn, sale
--    (เดิมทั้ง 3 มี skills:edit จึงติ๊กใบเซอร์ได้ — ตอนนี้ติ๊กไม่ได้แล้วตามที่ user สั่ง)
--    leader โดนกันอยู่แล้วอีกชั้นจากเพดาน 50 (allowance = score 100)
--
-- ⚠️ ไม่แตะสกิลปกติ — 4 หมวดทักษะ (hard/machine/product/soft) ยังใช้ skills:edit + เพดาน 50 เหมือนเดิม
--
-- ⚠️ RLS ต้อง join `skill_definitions` เพื่อรู้ว่าแถวนี้เป็นหมวดค่าฝีมือหรือไม่
--    สกิลที่ไม่มีนิยามใน skill_definitions (ข้อมูลกำพร้า) = ถือว่า "ไม่ใช่ค่าฝีมือ" (ไม่ล็อกเกินจำเป็น)
--
-- ROLLBACK:
--   alter policy employee_skills_write on public.employee_skills
--     with check ((has_perm('skills:edit') or has_perm('skills:approve_levelup') or has_perm('skills:delete'))
--                 and (coalesce(score,0) <= 50 or has_perm('skills:edit_high')));
--   delete from role_permissions   where permission_key = 'skills:edit_allowance';
--   delete from permission_catalog where resource='skills' and action='edit_allowance';
-- ============================================================================

insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'skills', 'edit_allowance',
       'ติ๊กใบเซอร์ค่าฝีมือ (หัวหน้าแผนกขึ้นไป)',
       coalesce((select group_name from public.permission_catalog
                  where resource='skills' and action='edit' limit 1), 'พนักงาน & ทักษะ'),
       coalesce((select sort from public.permission_catalog
                  where resource='skills' and action='edit' limit 1), 0) + 2
where not exists (
  select 1 from public.permission_catalog where resource='skills' and action='edit_allowance'
);

-- seed: หัวหน้าแผนกขึ้นไปเท่านั้น (ทุก role ในอีนัมมีแถว จะได้ปรับจาก /permissions ได้ครบ)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'skills:edit_allowance',
       r in ('admin'::user_role, 'manager'::user_role, 'supervisor'::user_role, 'dept_admin'::user_role)
  from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- RLS: แถวหมวดค่าฝีมือ ต้องมี skills:edit_allowance ถึงจะเขียนได้
alter policy employee_skills_write on public.employee_skills
  with check (
    (has_perm('skills:edit') or has_perm('skills:approve_levelup') or has_perm('skills:delete'))
    and (coalesce(score, 0) <= 50 or has_perm('skills:edit_high'))
    and (
      not exists (
        select 1 from public.skill_definitions sd
         where sd.name = employee_skills.skill_name
           and sd.category = 'allowance_skill'
      )
      or has_perm('skills:edit_allowance')
    )
  );
