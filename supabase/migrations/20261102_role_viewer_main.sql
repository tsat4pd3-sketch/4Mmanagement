-- 👀 ชุดสิทธิ์ `viewer` — ผู้ทดลองใช้ ดูอย่างเดียว  (Main · ewhdfqwfwofivojtsizn · 2026-11-02)
--
-- คำสั่ง user: "user ไว้ให้นายเราลองเข้ามาทดสอบดูโปรแกรม แต่จะไม่สามารถแก้ไขอะไรหรือลงข้อมูลอะไรได้"
--
-- หลัก: มีแต่คีย์ page:* (เข้าหน้าได้) · **ไม่มีคีย์ action เลย** ⇒ can() เป็นเท็จทุกปุ่ม ·
--       RLS ฝั่ง Main ที่ใช้ has_perm('<action>') บล็อกการเขียนทุกตาราง
--       ⚠️ ฝั่ง DR (anon) กันได้แค่ชั้นปุ่ม/handler — known gap เดิมของทั้งระบบ
-- ชุดหน้า = หน้าของ manager ยกเว้นหน้าตั้งค่า/ลงทะเบียน/ควบคุมอุปกรณ์/ข้อมูลอ่อนไหว (รายการด้านล่าง)
-- ไม่ให้ scope:all_units (ไม่มีอะไรให้เขียนอยู่แล้ว) · ขอบเขตการเห็นตั้งที่ /add-user: scope_depth='all'
--
-- ⚠️ ขั้น 1 ต้อง commit ก่อนขั้น 2 (enum value ใหม่ใช้ใน transaction เดียวกันไม่ได้ — 55P04)
--    ใน SQL Editor: รันบล็อก ① ก่อน แล้วค่อยรันบล็อก ②

-- ① เพิ่มค่า enum
alter type public.user_role add value if not exists 'viewer';

-- ② seed คีย์หน้า (รันหลัง ① สำเร็จ)
insert into public.role_permissions (role, permission_key, allowed)
select 'viewer', permission_key, true
from public.role_permissions
where role = 'manager' and allowed and permission_key like 'page:%'
  and permission_key not in (
    'page:/announcements', 'page:/audit-log', 'page:/notification-config', 'page:/display-rotation',
    'page:/qa-setup', 'page:/pm-setup', 'page:/process-setup', 'page:/linesetup', 'page:/org-setup',
    'page:/layout-setup', 'page:/storage-maintenance',
    'page:/register', 'page:/checkin', 'page:/remote'
  )
on conflict do nothing;

-- เช็คผล: ต้องได้ page ≈ 63 · action = 0
-- select count(*) filter (where permission_key like 'page:%') as page_keys,
--        count(*) filter (where permission_key not like 'page:%') as action_keys
-- from public.role_permissions where role='viewer' and allowed;

-- ⏪ rollback (ค่า enum ลบไม่ได้ · ลบได้แค่คีย์): delete from public.role_permissions where role='viewer';
