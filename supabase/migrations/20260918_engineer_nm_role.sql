-- ── Main project (ewhdfqwfwofivojtsizn — ชื่อในจอ Supabase = "MAIN") ──────────────────
-- role ใหม่: engineer_nm = ทีม Engineering New Model (คำขอ user 2026-09-18)
--   ให้ทีมงานพาร์ทรุ่นใหม่เข้ามาลองใช้ระบบได้ โดยเห็นแค่ 2 หน้า: /npi (พาร์ทใหม่ APQP/PPAP)
--   และ /pe-docs (Flow / PFMEA / Control Plan) — หน้าอื่นทั้งระบบปิดหมด
--
-- ทำไมต้องเป็น role ใหม่ ไม่ใช่ใช้ 'engineer' เดิม:
--   'engineer' = หน่วยงาน Process Engineering ซึ่งถือสิทธิ์ /products /machine-database /dashboard
--   และ npi:approve + pe:approve อยู่แล้ว (มี user จริงใช้อยู่) — ถ้าไปหั่นสิทธิ์ของ role นั้น
--   คนเดิมจะเข้าหน้าที่เคยใช้ไม่ได้ · สิทธิ์เข้าหน้าเป็น "ต่อ role" ไม่ใช่ "ต่อ user" จึงต้องแยก role
--   (เกณฑ์เพิ่ม role ตาม CLAUDE.md "Role System": ชุดสิทธิ์ต่างจาก role เดิมจริง)
--
-- ⚠️ ALTER TYPE ADD VALUE ใช้ค่าใหม่ใน transaction เดียวกันไม่ได้ — **ต้องรัน 2 ท่อนแยกกัน**
--    (ท่อน 1 ให้จบก่อน แล้วค่อยรันท่อน 2 · รันรวดเดียวจะได้ error "unsafe use of new value")
--
-- Rollback: ลบสิทธิ์ที่ seed ไว้ได้ (`delete from role_permissions where role='engineer_nm'`)
--   และย้าย user ที่ถือ role นี้กลับเป็น role อื่นก่อน — **แต่ค่าใน enum ลบไม่ได้** (PostgreSQL
--   ไม่รองรับ DROP VALUE) ค่าที่ค้างไว้ไม่มีผลกับใครถ้าไม่มี user ถือและไม่มีแถวสิทธิ์
--   · ฝั่งโค้ด revert ได้ปกติ (roleMeta.js) — role ที่ไม่มีใน ROLE_META จะแสดงเป็น key ดิบเท่านั้น ไม่พัง

-- ═══ ท่อนที่ 1 — รันอันนี้ก่อน แล้วรอให้จบ ═══
alter type user_role add value if not exists 'engineer_nm';

-- ═══ ท่อนที่ 2 — รันหลังท่อนที่ 1 จบแล้วเท่านั้น ═══
-- สิทธิ์เริ่มต้น (ปรับต่อได้เองที่หน้า /permissions — ไม่ต้องแก้โค้ด):
--   page:/npi + page:/pe-docs = เข้า 2 หน้านี้ได้
--   npi:edit  = สร้าง/แก้โปรเจค·พาร์ท·เฟส·งาน·แผน tooling (RLS ของ npi_* เช็ค has_perm('npi:edit'))
--   pe:edit   = สร้าง/แก้ OP·PFMEA·Control Plan + เสนอเข้าคลัง PFMEA กลาง
-- ไม่ให้ (เปิดเพิ่มได้ที่ /permissions ถ้า user ต้องการ):
--   npi:approve / pe:approve  = ปิดเฟส·อนุมัติ PSW·ออก revision เอกสารควบคุม·ยืนยัน master PFMEA
--   npi:manage_templates      = แก้แม่แบบเฟส/รายการเอกสารกลางต่อลูกค้า
insert into role_permissions (role, permission_key, allowed) values
  ('engineer_nm','page:/npi',    true),
  ('engineer_nm','page:/pe-docs',true),
  ('engineer_nm','npi:edit',     true),
  ('engineer_nm','pe:edit',      true)
on conflict (role, permission_key) do nothing;

-- ตรวจหลังรัน:
-- select unnest(enum_range(null::user_role))::text;                      -- ต้องมี engineer_nm
-- select permission_key, allowed from role_permissions where role='engineer_nm' order by 1;
