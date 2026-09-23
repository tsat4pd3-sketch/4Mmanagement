-- ─────────────────────────────────────────────────────────────────────────────
-- 👥 เลิกใช้คำ direct/indirect ซ้ำ 2 แกน — `employees.staff_kind`   (Main project)
-- 2026-09-23 · user เคาะ (docs/ORG-AXES-DECISION.md §5.4 + §7 ข้อ 3)
--
-- ── ปัญหา ───────────────────────────────────────────────────────────────────
--   ระบบมีแกน direct/indirect **2 แกน ค่าเหมือนกันเป๊ะ แต่ตอบคนละคำถาม**:
--     `org_nodes.labor_type` (2026-07-22) = ราย**แผนก** → คิดต้นทุนเป็นแรงงานตรงไหม
--     `employees.staff_kind` (2026-09-21) = ราย**คน**   → เช็คชื่อ/นับกำลังคนไหม
--   และ **ขัดกันจริงที่ช่าง MTN**: labor_type = indirect (บัญชี) · staff_kind = direct (เช็คชื่อ 25/25)
--   ⇒ คนอ่านโค้ด/เอกสารคนถัดไปเอา 2 แกนมาแทนกันแน่นอน
--
-- ── ทางแก้ ──────────────────────────────────────────────────────────────────
--   เปลี่ยน**ชื่อค่า**ฝั่ง staff_kind ให้ไม่ชนกัน (ความหมายเดิมทุกประการ):
--     direct   → `shopfloor`  (🧑‍🏭 หน้างาน  — เช็คชื่อ · มีสกิล · นับกำลังคน)
--     indirect → `support`    (🗂️ สนับสนุน — QA/PE/ธุรการ/สโตร์/เซลล์ ไม่เช็คชื่อ ไม่นับกำลังคน)
--   `org_nodes.labor_type` **ไม่แตะ** — คงคำ direct/indirect ไว้ตามภาษาบัญชี/ต้นทุน
--
-- ⚠️ **check constraint ยังรับค่าเก่าไว้ด้วย** โดยตั้งใจ — ช่วง deploy มีแท็บที่เปิดค้าง
--    ด้วย JS ตัวเก่า ถ้าบังคับค่าใหม่ทันที การเพิ่มพนักงานจากแท็บนั้นจะล้ม 23514
--    ตัวอ่านทั้งหมดอยู่ที่ `src/utils/staffKind.js` ซึ่งเข้าใจทั้งค่าเก่าและค่าใหม่
--
-- ผลกับตัวเลข: **ไม่มีอะไรขยับ** — แค่เปลี่ยนคำ (225 active = shopfloor 223 · support 2)
--
-- ROLLBACK:
--   update employees set staff_kind = case staff_kind when 'shopfloor' then 'direct'
--                                                     when 'support'   then 'indirect'
--                                                     else staff_kind end;
--   alter table employees alter column staff_kind set default 'direct';
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.employees drop constraint if exists employees_staff_kind_chk;

alter table public.employees
  add constraint employees_staff_kind_chk
  check (staff_kind in ('shopfloor', 'support', 'direct', 'indirect'));

update public.employees
   set staff_kind = case staff_kind when 'direct'   then 'shopfloor'
                                    when 'indirect' then 'support'
                                    else staff_kind end
 where staff_kind in ('direct', 'indirect');

alter table public.employees alter column staff_kind set default 'shopfloor';

comment on column public.employees.staff_kind is
  'shopfloor = พนักงานหน้างาน/ช่าง (เช็คชื่อ · มีสกิล · นับกำลังคน) · support = สายสนับสนุน QA/PE/ธุรการ/สโตร์ (ไม่เช็คชื่อ ไม่นับกำลังคน) — ⚠️ คนละแกนกับ org_nodes.labor_type (direct/indirect ราย*แผนก* เพื่อคิดต้นทุน · ขัดกันที่ช่าง MTN โดยตั้งใจ) · อ่าน/กรองผ่าน src/utils/staffKind.js เท่านั้น · ค่าเก่า direct/indirect ยังรับไว้ช่วง deploy';

drop index if exists employees_staff_kind_idx;
create index if not exists employees_staff_kind_idx
  on public.employees(staff_kind) where staff_kind <> 'shopfloor';
