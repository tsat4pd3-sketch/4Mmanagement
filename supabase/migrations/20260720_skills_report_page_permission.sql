-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- หน้าใหม่ /skills-report (Skill Matrix & ค่าฝีมือ — แยก 3 แท็บสกิลจาก /report ไปหมวด "พนักงาน & ทักษะ")
-- เป็น <Report mode="skills" /> ใช้ component เดิมทั้งหมด — seed สิทธิ์เข้าหน้าเหมือน /report (ทุก role)
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/skills-report', true from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
