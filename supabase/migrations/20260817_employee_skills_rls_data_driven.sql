-- ============================================================================
-- RLS ของ employee_skills เลิก hardcode role array → อ่าน role_permissions (2026-08-17)
-- apply แล้ว 2026-08-17 (Main project)
--
-- ปัญหาที่เจอจริง — policy เดิม `employee_skills_write_privileged` เช็ค
--     profiles.role = any(array['admin','manager','supervisor','leader'])
--   ซึ่ง "แข็ง" อยู่ใน DB ขณะที่ทั้งระบบยึด role_permissions เป็น source of truth
--   (CLAUDE.md — "สิทธิ์ไม่ hardcode ในโค้ดอีกต่อไป") → drift กันจนเพี้ยน 2 ทางสวนกัน:
--
--   1. role `mtn` มี skills:edit = true ใน role_permissions (UI โชว์แท็บ/ช่องให้แก้)
--      แต่ RLS ปฏิเสธ → ช่างติ๊กเพิ่มสกิลให้ช่างด้วยกันแล้วเด้ง error 42501
--      (พนักงานสนับสนุน MTN/DIE MTN 18 คน ยังไม่มี employee_skills สักแถว = เพิ่มไม่ได้เลย)
--      แอดมินหน่วยงาน (bucket dept_admin) โดนแบบเดียวกัน เพราะ has_perm() เดิมดูแค่ base role
--
--   2. role `leader` มี skills:edit = false (ตั้งใจ — คะแนนสกิลมาจาก farm + ด่านอนุมัติ
--      ดู fn_daily_skill_farm / fn_weekly_skill_update) แต่ RLS "อนุญาต" → เขียนได้จริง
--      ผ่านแผงระดับทักษะในโมดัลแก้ไขพนักงาน ซึ่งไม่เคยถูก gate ด้วย can('skills','edit')
--
-- ⚠️ ผลของ migration นี้ (วัดกับผู้ใช้จริงแล้ว):
--      + ได้สิทธิ์ (แก้บั๊ก): mtn 8 คน · planner_store(dept_admin) 1 คน
--      − เสียสิทธิ์: leader 17 คน ← ตรงตาม role_permissions ที่ตั้งไว้ว่า false
--   ถ้าอยากให้ leader แก้สกิลได้เหมือนเดิม: ติ๊ก leader × skills:edit ที่หน้า /permissions
--   (1 คลิก มีผลทันทีทั้ง UI และ RLS ไม่ต้อง deploy) — นี่คือจุดประสงค์ของการทำ data-driven
--
-- ⚠️ has_perm() มีอยู่ก่อนแล้ว และมี 21 policy ฝั่ง QA อ้างถึง (qa_parts, qa_ncr, qa_capa,
--   qa_measurements, qa_inspection_*, qa_characteristics, qa_instruments, qa_part_drawings)
--   → ใช้ CREATE OR REPLACE คงชื่อพารามิเตอร์ `perm_key` ไว้ ห้ามเปลี่ยน (จะ error 42P13)
--   การเติม bucket dept_admin ทำให้ policy QA เหล่านั้นยอมรับแอดมินหน่วยงานด้วย ซึ่ง
--   "ตรงกับที่ UI อนุญาตอยู่แล้ว" (dept_admin มี qa:record/qa:manage = true) = ปิดบั๊ก
--   "ปุ่มโผล่แต่เซฟไม่ได้" คลาสเดียวกัน ไม่ใช่การแจกสิทธิ์ใหม่
--
-- ROLLBACK:
--   -- 1) คืน has_perm เวอร์ชันก่อน (ไม่มี bucket dept_admin)
--   create or replace function public.has_perm(perm_key text)
--   returns boolean language sql stable security definer set search_path to 'public' as $f$
--     select coalesce((select p.role = 'admin'::user_role or exists (
--         select 1 from role_permissions rp
--         where rp.role = p.role and rp.permission_key = perm_key and rp.allowed)
--       from profiles p where p.id = auth.uid()), false);
--   $f$;
--   -- 2) คืน policy เดิม
--   drop policy if exists employee_skills_write on public.employee_skills;
--   create policy employee_skills_write_privileged on public.employee_skills
--     for all to authenticated
--     using (exists (select 1 from profiles where profiles.id = auth.uid()
--            and profiles.role = any (array['admin','manager','supervisor','leader']::user_role[])))
--     with check (exists (select 1 from profiles where profiles.id = auth.uid()
--            and profiles.role = any (array['admin','manager','supervisor','leader']::user_role[])));
-- ============================================================================

-- ── has_perm(perm_key) — ตัวเช็คสิทธิ์กลางฝั่ง DB ─────────────────────────────
-- mirror ของ hasPermission() ใน src/utils/permissions.js:
--   admin bypass → role_permissions ของ base role → bucket dept_admin (ห้ามปลดล็อก page:*)
-- SECURITY DEFINER: ต้องอ่าน profiles/role_permissions โดยไม่ติด RLS ของตารางนั้น
-- คืนแค่ boolean ของ "ผู้เรียกเอง" ไม่เปิดเผยข้อมูลผู้ใช้คนอื่น
create or replace function public.has_perm(perm_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select p.role = 'admin'::user_role
            or exists (
              select 1 from role_permissions rp
              where rp.role = p.role
                and rp.permission_key = perm_key
                and rp.allowed
            )
            -- แอดมินหน่วยงาน: bucket ให้ได้เฉพาะ action ห้ามปลดล็อกหน้า (page:*)
            -- บังคับกฎที่นี่ ไม่พึ่งความถูกต้องของ seed (migration ที่ seed ด้วย enum_range
            -- จะแจก page:* ให้ทุก role ในอีนัมรวม dept_admin ด้วย) — ตรงกับ permissions.js
            or (
              coalesce(p.is_dept_admin, false)
              and perm_key not like 'page:%'
              and exists (
                select 1 from role_permissions rp
                where rp.role = 'dept_admin'::user_role
                  and rp.permission_key = perm_key
                  and rp.allowed
              )
            )
     from profiles p
     where p.id = auth.uid()),
    false
  );
$function$;

comment on function public.has_perm(text) is
  'เช็คสิทธิ์ของ auth.uid() จาก role_permissions (+ bucket dept_admin ที่ห้ามปลดล็อก page:*) — ใช้ใน RLS แทนการ hardcode role array · mirror ของ hasPermission() ใน src/utils/permissions.js';

revoke all on function public.has_perm(text) from public;
revoke all on function public.has_perm(text) from anon;
grant execute on function public.has_perm(text) to authenticated;

-- ── policy ใหม่ ───────────────────────────────────────────────────────────────
-- รวม 3 key ที่ล้วนต้องเขียน employee_skills จริง:
--   skills:edit            — ตั้ง/แก้คะแนนในโมดัลพนักงาน + แท็บ ⚙️ กำหนดสกิล
--   skills:approve_levelup — อนุมัติ/ปฏิเสธคำขออัพระดับ (เขียน score / ล้าง pending_level)
--   skills:delete          — ลบนิยามสกิลแล้วกวาดแถวของพนักงานทิ้ง
-- แยกเป็น key เพื่อให้ admin ปรับที่ /permissions ได้โดยไม่ต้องแตะ RLS อีก
drop policy if exists employee_skills_write_privileged on public.employee_skills;
drop policy if exists employee_skills_write on public.employee_skills;

create policy employee_skills_write on public.employee_skills
  for all
  to authenticated
  using (
    public.has_perm('skills:edit')
    or public.has_perm('skills:approve_levelup')
    or public.has_perm('skills:delete')
  )
  with check (
    public.has_perm('skills:edit')
    or public.has_perm('skills:approve_levelup')
    or public.has_perm('skills:delete')
  );

-- policy อ่าน (employee_skills_select_authenticated = true) คงเดิม ไม่แตะ
-- หมายเหตุ: fn_daily_skill_farm / fn_weekly_skill_update เป็น SECURITY DEFINER
--   → bypass RLS อยู่แล้ว ไม่กระทบ
