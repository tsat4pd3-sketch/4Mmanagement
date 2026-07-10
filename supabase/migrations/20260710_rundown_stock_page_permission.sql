-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- บันทึกย้อนหลัง (2026-07-10): สิทธิ์หน้า /rundown-stock ถูก toggle ใน production ไปแล้ว
-- แต่ไม่มี migration file — เขียนไว้เพื่อให้ restore/environment ใหม่ได้สิทธิ์ครบ
-- (hasPermission เป็น fail-closed: ไม่มีแถว = ทุก role ที่ไม่ใช่ admin เข้าไม่ได้)
-- ปลอดภัยต่อการรันซ้ำ: on conflict do nothing

-- สิทธิ์หน้า Rundown Stock — copy จากสิทธิ์ /planner-sales (แยกหน้ามาจากกันเมื่อ 2026-07-10)
insert into role_permissions (role, permission_key, allowed)
select role, 'page:/rundown-stock', allowed from role_permissions
where permission_key = 'page:/planner-sales'
on conflict (role, permission_key) do nothing;
