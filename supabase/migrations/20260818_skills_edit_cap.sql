-- ============================================================================
-- เพดานคะแนนที่ "แก้ด้วยมือ" ได้ — หัวหน้ากลุ่มตั้งได้ถึง 50 (2026-08-18 · คำสั่ง user)
--
-- ที่มา: เปิดสิทธิ์ skills:edit ให้ leader ไปแล้ว (20260817_employee_skills_audit.sql)
--   user สั่งต่อว่า "leader ให้ได้ถึง 50" → ตั้งคะแนนเองได้ไม่เกินระดับ "มาตรฐาน"
--   ระดับสูงกว่านั้น (75 แก้ปัญหาได้ / 100 ผู้เชี่ยวชาญ) ต้องผ่านคนที่สิทธิ์สูงกว่า
--   สอดคล้องกับ SKILL_GATES (25/50/75/100) + ด่านอนุมัติ skill_level_up_requests ที่มีอยู่เดิม
--
-- ── กลไก: permission key ใหม่ `skills:edit_high` (ตั้งคะแนนเกิน 50) ──────────
--   มี key นี้  = ตั้งได้ถึง 100 (พฤติกรรมเดิม)
--   ไม่มี key   = ตั้งได้ไม่เกิน 50
--   ปรับผู้ถือได้ที่ /permissions มีผลทั้ง UI และ RLS ทันที ไม่ต้อง deploy
--
-- ⚠️ seed = ผู้ถือ skills:edit ทุก role ยกเว้น leader → **พฤติกรรมของคนอื่นไม่เปลี่ยนเลย**
--    (admin, dept_admin, manager, mtn, sale, supervisor ยังตั้งได้ถึง 100 เหมือนเดิม)
--    user สั่งจำกัดเฉพาะ leader — ห้ามเผลอไปรัดคนอื่นด้วย
--
-- ⚠️ role ที่เพิ่มทีหลังจะไม่มีแถว = ถูกจำกัดที่ 50 (fail-safe เลือกฝั่งแคบกว่า)
--    ถ้า role ใหม่ต้องตั้งได้ถึง 100 ให้ติ๊กที่ /permissions
--
-- ⚠️ **ไม่กระทบ EXP farm อัตโนมัติ** — fn_daily_skill_farm / fn_weekly_skill_update
--    เป็น SECURITY DEFINER (bypass RLS) → คะแนนที่สะสมจากการทำงานจริงยังขึ้นเกิน 50 ได้
--    เพดานนี้คุมเฉพาะ "การพิมพ์คะแนนใส่เอง" ซึ่งเป็นจุดที่ข้ามด่านอนุมัติได้
--
-- ⚠️ **ไม่กระทบด่านอนุมัติ level-up** — ผู้อนุมัติคือ admin/manager/supervisor
--    ซึ่งได้ edit_high ครบทุกคน → กด approve ขึ้น 75/100 ได้เหมือนเดิม
--    (flow นั้นเขียน employee_skills จาก client จริง จึงต้องเช็คให้แน่ว่าไม่โดนบล็อก)
--
-- ⚠️ WITH CHECK ที่ไม่ผ่าน = **error 42501 ดังๆ** (ต่างจาก USING ที่เงียบเป็น 0 แถว)
--    → ฝั่ง UI ต้อง gate ให้ตรงกัน ไม่ปล่อยให้ผู้ใช้ไปเจอ error ดิบ
--
-- ROLLBACK:
--   alter policy employee_skills_write on public.employee_skills
--     with check (has_perm('skills:edit') or has_perm('skills:approve_levelup') or has_perm('skills:delete'));
--   delete from role_permissions where permission_key = 'skills:edit_high';
--   delete from permission_catalog where resource = 'skills' and action = 'edit_high';
-- ============================================================================

-- ── ลงทะเบียนใน permission_catalog ให้โผล่ในหน้า /permissions ────────────────
-- (กฎเหล็ก: action ใหม่ที่ไม่ลงทะเบียน = admin ปรับจาก UI ไม่ได้เลย)
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'skills', 'edit_high',
       'ตั้งคะแนนทักษะเกิน 50 (ระดับแก้ปัญหาได้/ผู้เชี่ยวชาญ)',
       coalesce((select group_name from public.permission_catalog
                  where resource='skills' and action='edit' limit 1), 'พนักงาน & ทักษะ'),
       coalesce((select sort from public.permission_catalog
                  where resource='skills' and action='edit' limit 1), 0) + 1
where not exists (
  select 1 from public.permission_catalog where resource='skills' and action='edit_high'
);

-- ── seed: ทุก role ที่ตั้งคะแนนได้อยู่แล้ว ยกเว้น leader ─────────────────────
insert into public.role_permissions (role, permission_key, allowed)
select rp.role, 'skills:edit_high',
       (rp.allowed and rp.role <> 'leader'::user_role)
  from public.role_permissions rp
 where rp.permission_key = 'skills:edit'
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── RLS: เพดานคะแนนฝั่ง DB (กันยิง API ตรงข้าม UI) ──────────────────────────
alter policy employee_skills_write on public.employee_skills
  with check (
    (has_perm('skills:edit') or has_perm('skills:approve_levelup') or has_perm('skills:delete'))
    and (coalesce(score, 0) <= 50 or has_perm('skills:edit_high'))
  );
