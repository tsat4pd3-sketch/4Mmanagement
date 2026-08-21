-- 🔧 "ช่างของฝ่ายผลิต" — ตั้งค่าให้รับ/จ่ายงานซ่อม (MO ขั้น 2→3) ได้
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- ที่มา (feedback หน้างาน 2026-08-21):
--   "ช่างของผลิต role มันไม่มีให้เลือก เค้าอยู่ระหว่างระดับส่วนกับระดับกลุ่ม
--    ในลำดับขั้นการรับ-จ่ายงานซ่อม ขั้นตอนที่ 2 ไป 3 — อยากให้ setup ตรงนี้ได้"
--
-- ปัญหาจริงมี 2 ชั้น (แก้ทั้งคู่ในไฟล์นี้):
--   ① เลือกเขาเป็น "ช่างผู้รับผิดชอบ" ในขั้น 2 ไม่ได้
--      MtnRepair สร้างลิสต์ช่างจาก employees โดย **เดาทีมจากชื่อ department/section**
--      (`teamForSection`) ซึ่งจับได้แค่ JIG / DIE / MTN — ทีม production เดาไม่ได้โดยตั้งใจ
--      (ส่วนงานผลิตมีหลายชื่อ PD1/PD2/GOR… เดาเหมาจะไปโดน QA/ธุรการด้วย)
--      → ช่างฝ่ายผลิต **ไม่มีวันโผล่ในลิสต์** ไม่ว่าจะกรอกข้อมูลยังไง
--      ⇒ ให้ "ติ๊กเอง" ที่ข้อมูลพนักงาน แทนการเดา
--   ② ทำขั้น 2→3 ไม่ได้ เพราะ `mtn_repair:service` seed ไว้แค่ admin/manager/mtn
--      ⇒ คีย์ใหม่ `mtn_repair:service_own_team` = ทำได้ **เฉพาะใบของทีมที่ตัวเองสังกัด**
--
-- ⚠️ ทำไมไม่เพิ่ม role ใหม่ ("ช่างฝ่ายผลิต"):
--    กฎเหล็กของโปรเจค — เจอแกนใหม่ให้เพิ่ม attribute ห้ามเพิ่ม role
--    (ไม่งั้นตอน rollout หลายโรงงาน role จะระเบิดเป็นสิบตัว)
--    แกน "คนนี้เป็นช่างของทีมไหน" มีที่อยู่แล้วคือ `profiles.mtn_teams` (ตั้งที่ /add-user)
--    คีย์ใหม่จึงคุมด้วย role + ตัวบุคคลผ่าน mtn_teams พร้อมกัน
--      → ติ๊กให้ role `leader` ก็ไม่ได้แปลว่าหัวหน้ากลุ่มทุกคนทำได้
--        ทำได้เฉพาะคนที่ถูกตั้ง "ทีมช่างซ่อม" ไว้ และเฉพาะใบของทีมนั้น

-- ── ① ทีมช่างซ่อมของพนักงาน (ข้อมูล ไม่ใช่การเดา) ────────────────────────────
-- ค่า = mtn_teams.key ฝั่ง DR (maintenance / jig_maintenance / die_maintenance / production)
-- ⚠️ ไม่ผูก FK เพราะ mtn_teams อยู่คนละ project (Main ↔ DR) — เก็บเป็น text เหมือน
--    คอลัมน์ทีมอื่นทั้งระบบ · null = ไม่ใช่ช่าง (ระบบยังเดาจาก department/section ให้เหมือนเดิม)
alter table public.employees
  add column if not exists mtn_team text;

comment on column public.employees.mtn_team is
  'ทีมช่างซ่อมที่พนักงานคนนี้สังกัด (mtn_teams.key ฝั่ง DR) — ใช้สร้างลิสต์ "มอบหมายช่าง" ในใบ MO. null = ไม่ใช่ช่าง/ให้ระบบเดาจากแผนกเหมือนเดิม';

-- index เล็กๆ ช่วยตอนดึงเฉพาะช่าง (ตารางพนักงานหลักร้อยแถว ไม่ได้จำเป็นมาก แต่ไม่เสียหาย)
create index if not exists employees_mtn_team_idx
  on public.employees (mtn_team) where mtn_team is not null;

-- ── ② สิทธิ์ทำขั้น 2-4 ของ "ทีมตัวเอง" ──────────────────────────────────────
-- ⚠️ 2 จุดที่ต้องระวัง (กับดักที่ CLAUDE.md บันทึกไว้แล้ว — เคยโดนมาแล้วรอบหนึ่ง):
--   1) group_name ต้องเป็นชื่อหมวดตาม NAV_GROUP_ORDER เป๊ะ = 'การตรวจสอบและซ่อมบำรุง'
--      พิมพ์ 'ซ่อมบำรุง' เอง = หมวดกำพร้าโผล่กลางตาราง /permissions
--      (audit 2026-08-19 เจอ 'ซ่อมบำรุง'/'ประชุมแถวเช้า' แบบนี้ ต้องรื้อจัดใหม่ทั้งตาราง)
--   2) sort ต้องไม่ชนของเดิม — 615 เป็นของ am:record อยู่แล้ว
--      ใช้ 607 ให้อยู่ติดกับ mtn_repair:service (606) จะได้อ่านคู่กันรู้เรื่อง
--      แล้วเลื่อนคีย์ mtn_repair ที่เหลือลง 1 (ตั้งค่าตรงๆ ไม่ใช่ sort+1 → รันซ้ำได้)
update permission_catalog as c set sort = v.s
  from (values ('report', 605), ('service', 606), ('qa', 608),
               ('approve', 609), ('manage_master', 610), ('delete', 611)) as v(a, s)
 where c.resource = 'mtn_repair' and c.action = v.a;

insert into permission_catalog (resource, action, label, group_name, sort)
values ('mtn_repair', 'service_own_team',
        'ใบซ่อม: รับงาน/ซ่อม/ตรวจ (ขั้น 2-4) — เฉพาะใบของทีมตัวเอง',
        'การตรวจสอบและซ่อมบำรุง', 607)
-- do update (ไม่ใช่ do nothing) → ถ้าเคยรันเวอร์ชันที่หมวด/sort ผิดไปแล้ว รันซ้ำแล้วหายเอง
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

insert into role_permissions (role, permission_key, allowed)
select r.role, 'mtn_repair:service_own_team',
       r.role::text = any(array[
         'admin','manager','mtn',      -- ถือ service เต็มอยู่แล้ว (ใส่ให้ชัด)
         'supervisor','leader',        -- ← ช่างฝ่ายผลิตส่วนใหญ่อยู่ 2 role นี้
         'engineer','dept_admin'
       ])
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ⚠️ ให้ role ไปแล้ว **ยังทำอะไรไม่ได้** จนกว่าจะตั้ง "ทีมช่างซ่อม" ให้ตัวบุคคล
--    ที่ /add-user (profiles.mtn_teams) — นั่นคือด่านที่คุมจริง
--
-- ตรวจผลหลังรัน:
--   select column_name from information_schema.columns
--    where table_name='employees' and column_name='mtn_team';
--   select role, allowed from role_permissions
--    where permission_key='mtn_repair:service_own_team' order by role;
