-- ═══ เปิดสิทธิ์ดูหน้ากิจกรรม 9 หน้าให้ role manager (2026-11-26 · คำสั่ง user "MANAGER ขึ้นไปเห็น") ═══
-- Target project: MAIN "MAIN" (ewhdfqwfwofivojtsizn)
-- · admin เห็นอยู่แล้ว (bypass) · "manager ขึ้นไป" = admin + manager (roleMeta orgLevel)
-- · เพิ่มแถวเท่านั้น ไม่สร้างตาราง ไม่แตะ RLS · idempotent · คีย์หน้า (page:*) ไม่อยู่ใน permission_catalog (ตามแบบเดิมของระบบ)
-- · ตั้งค่าเพิ่ม/ถอนรายหน้าได้ที่ /permissions หมวด "กิจกรรม" ภายหลัง

insert into role_permissions (role, permission_key, allowed)
select 'manager'::user_role, k, true
from unnest(array[
  'page:/activity-100p', 'page:/activity-5s', 'page:/activity-smart', 'page:/activity-kyt', 'page:/activity-kaizen',
  'page:/activity-qcc', 'page:/activity-lean', 'page:/activity-cfo', 'page:/activity-cfp'
]) k
on conflict (role, permission_key) do update set allowed = true, updated_at = now();

-- ── ตรวจหลังรัน (MAIN) — ต้องได้ 9 แถว allowed = true ──
-- select permission_key, allowed from role_permissions where role = 'manager' and permission_key like 'page:/activity-%' order by 1;

-- ── Rollback (MAIN) ──
-- delete from role_permissions where role = 'manager' and permission_key like 'page:/activity-%';
