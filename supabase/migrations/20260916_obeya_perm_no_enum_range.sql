-- ═══════════════════════════════════════════════════════════════════════════
-- 🔧 แก้กับดัก seed สิทธิ์ด้วย `enum_range` — Main project
--    (ewhdfqwfwofivojtsizn · ชื่อในจอ Supabase = "MAIN")            2026-09-16
--
-- ปัญหา: `20260915_obeya_action_loop.sql:41,51` seed สิทธิ์ /obeya ด้วย
--   `select unnest(enum_range(null::user_role))` = **ล็อกรายชื่อ role ณ วันที่รัน**
--   role ที่เพิ่มเข้า enum หลังจากนั้นจะ "ไม่มีแถว" ⇒ `has_perm()` คืน false
--   ⇒ เข้าหน้า /obeya ไม่ได้ **แบบเงียบสนิท ไม่มี error ไม่มี log**
--   เป็นกับดักเดิมที่เคยกัดมาแล้วกับ mtn / engineer / planner_store
--   (บันทึกไว้ที่ docs/ENGINEERING-PRINCIPLES.md §seed สิทธิ์ · docs/modules/pages-routes.md)
--
-- สถานะวันนี้: ตรวจแล้ว 12 role ปัจจุบันมีแถวครบทั้ง 2 คีย์ ⇒ **ยังไม่มีใครพัง**
--   migration นี้จึงเป็น no-op กับข้อมูลวันนี้ (on conflict do nothing) — มีไว้เพื่อ
--   (ก) ให้รายชื่อ role อยู่ในไฟล์ ตรวจสอบได้ด้วยตา ไม่ซ่อนอยู่ใน enum
--   (ข) เป็นแม่แบบที่ copy ไปใช้ตอนเพิ่ม role ใหม่ (เติมชื่อในลิสต์แล้วรันซ้ำ)
--
-- ⚠️ เพิ่ม role ใหม่เข้า user_role เมื่อไหร่ **ต้องกลับมาเติมชื่อในไฟล์นี้แล้วรันซ้ำ**
--    ตัวกันการใช้ `enum_range` ซ้ำอยู่ในด่าน build แล้ว: src/utils/__tests__/regressionGuards.test.mjs
--
-- ย้อนกลับ: ไม่ต้อง (idempotent · ไม่ลบ ไม่ทับค่าที่ admin ปรับเอง)
-- ═══════════════════════════════════════════════════════════════════════════

-- /obeya: ทุก role ดูได้ (จอแขวนในห้อง Obeya ต้องเปิดได้ด้วยบัญชี display)
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/obeya', true
from unnest(array[
  'admin', 'manager', 'supervisor', 'leader', 'qa', 'mtn',
  'engineer', 'planner_store', 'sale', 'document_control', 'dept_admin', 'display'
]::user_role[]) as r
on conflict (role, permission_key) do nothing;

-- obeya:record — leader ขึ้นไป (ชุดเดียวกับ morning_meeting:record)
insert into role_permissions (role, permission_key, allowed)
select r, 'obeya:record', r in ('admin', 'manager', 'supervisor', 'leader')
from unnest(array[
  'admin', 'manager', 'supervisor', 'leader', 'qa', 'mtn',
  'engineer', 'planner_store', 'sale', 'document_control', 'dept_admin', 'display'
]::user_role[]) as r
on conflict (role, permission_key) do nothing;

-- คิวรีเช็คหลังรัน (ต้องไม่คืนแถวไหนเลย = ไม่มี role ที่ตกหล่น)
-- select r.role::text from (select unnest(enum_range(null::user_role)) role) r
--  where not exists (select 1 from role_permissions p
--                    where p.role = r.role and p.permission_key = 'page:/obeya');
