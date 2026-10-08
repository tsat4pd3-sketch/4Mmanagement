-- ─────────────────────────────────────────────────────────────────────────────
-- 🧭 ฐานรากแกน "สังกัด" — ผูกคน/บัญชี เข้าผังองค์กรด้วย **id** ไม่ใช่ชื่อ   (Main project)
-- 2026-09-23 · docs/ORG-AXES-DECISION.md §5.1 (user เคาะแล้ว)
--
-- ── ปัญหา (วัดจริง 23/09) ───────────────────────────────────────────────────
--   ผังองค์กรจริงมีอยู่แล้วและถูกต้อง: `org_nodes` 51 โหนด (6 ฝ่าย · 14 แผนก · 19 ไลน์ · 12 ทีม)
--   มี id + parent_id ไล่สายบังคับบัญชาได้ครบ — **แต่ไม่มีตารางไหนชี้มาเลยสักคอลัมน์**
--   ทุกที่เก็บเป็น *ข้อความ* แล้วจับคู่ด้วยชื่อ กระจาย 11 คอลัมน์ (employees 6 · profiles 5)
--
--   ⇒ พังจริง 3 แบบ:
--     1. **ชื่อแผนกซ้ำ** — `ทั่วไป` มี 2 อัน (ใต้ PD2 และใต้ PD4) ⇒ 15 คนจับคู่ด้วยชื่อไม่ได้เลย
--     2. **พิมพ์มือไม่ตรงผัง** — `ฝ่ายผลิต` 28 คน (ไม่ใช่ชื่อแผนก) · `ฝ่าผลิต` · `Smail Press`
--     3. **ย้ายคน 1 คน = แก้หลายคอลัมน์ให้ตรงกันเอง** แก้ไม่ครบ = สิทธิ์/แจ้งเตือนเพี้ยนเงียบ
--
-- ── ทางแก้ ──────────────────────────────────────────────────────────────────
--   เพิ่ม `org_node_id` ชี้ `org_nodes.id` เป็น **แกนสังกัดแกนเดียว**
--   คอลัมน์ข้อความเดิม **ไม่ลบ ไม่แตะ** — ลดชั้นเป็น "สำเนาไว้โชว์/ไว้ export"
--   ⇒ หน้าเก่าที่อ่านข้อความยังทำงานเหมือนเดิมทุกหน้า (backward-compatible 100%)
--
-- ── ผล backfill (คำนวณล่วงหน้าแล้ว · active 225 คน) ──────────────────────────
--   185 คน → โหนด**แผนก**ตรงเป๊ะ (แผนกตรง + อยู่ใต้ฝ่ายเดียวกัน — แก้เคส `ทั่วไป` ซ้ำได้หมด)
--     7 คน → โหนดแผนกที่ชื่อไม่ซ้ำทั้งผัง
--    31 คน → ได้แค่ระดับ**ฝ่าย** (กลุ่ม `ฝ่ายผลิต` — ไม่ผิด แค่หยาบ ต้องมีคนชี้แผนกทีหลัง)
--     2 คน → ไม่รู้เลย (ปล่อย null)
--
-- 🔴 **`org_node_src` = ที่มาของค่า ไม่ใช่ของประดับ** — ต้องแยก "ระบบเดาหยาบๆ" ออกจาก
--    "คนยืนยันแล้ว" ไม่งั้นอีก 3 เดือนไม่มีใครรู้ว่าแถวไหนเชื่อถือได้
--    จอ /operator ใช้คอลัมน์นี้ขึ้นป้าย "ยังไม่ระบุแผนก 31 คน" ให้ไล่ติ๊ก
--
-- ⚠️ **ยังไม่มีหน้าไหนอ่าน `org_node_id` ในคอมมิทนี้** — เป็นฐานรากล้วนๆ
--    พฤติกรรมวันที่ apply เท่าเดิมเป๊ะทุกจอ (เพิ่มคอลัมน์ + เติมค่า ไม่มีใครอ่าน)
--
-- ROLLBACK:
--   alter table public.profiles  drop column if exists org_node_id;
--   alter table public.employees drop column if exists org_node_id, drop column if exists org_node_src;
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════
-- 1) คอลัมน์
-- ══════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists org_node_id  uuid references public.org_nodes(id) on delete set null,
  add column if not exists org_node_src text;

alter table public.profiles
  add column if not exists org_node_id  uuid references public.org_nodes(id) on delete set null;

do $$ begin
  alter table public.employees add constraint employees_org_node_src_chk
    check (org_node_src is null or org_node_src in ('auto_dept', 'auto_section', 'manual'));
exception when duplicate_object then null; end $$;

comment on column public.employees.org_node_id is
  'สังกัดในผังองค์กร (org_nodes.id) — **แกนสังกัดแกนเดียวของระบบ** · คอลัมน์ section/department/group_name/line_id/team เป็นสำเนาไว้โชว์เท่านั้น ห้ามใช้ตัดสินขอบเขต/สิทธิ์/ผู้รับแจ้งเตือน (docs/ORG-AXES-DECISION.md §5.1)';
comment on column public.employees.org_node_src is
  'ที่มาของ org_node_id: auto_dept = จับคู่แผนกได้ตรง · auto_section = ระบบเดาได้แค่ระดับฝ่าย **ต้องมีคนมาชี้แผนก** · manual = คนยืนยันแล้ว';
comment on column public.profiles.org_node_id is
  'หน่วยที่บัญชีนี้สังกัด (org_nodes.id) — "เห็นกว้างแค่ไหน" เป็นคนละแกน (scope_depth) ห้ามเอาคอลัมน์นี้ไปขยายขอบเขตเอง';

create index if not exists employees_org_node_idx on public.employees(org_node_id) where org_node_id is not null;
create index if not exists profiles_org_node_idx  on public.profiles(org_node_id)  where org_node_id is not null;

-- ══════════════════════════════════════════════════════════════════
-- 2) backfill employees — เรียงจากละเอียดไปหยาบ หยุดที่ตัวแรกที่จับคู่ได้
-- ══════════════════════════════════════════════════════════════════
with dept as (
  select d.id, d.name, s.name as sec_name
    from public.org_nodes d left join public.org_nodes s on s.id = d.parent_id
   where d.is_active and d.kind = 'department'),
sec as (select id, name from public.org_nodes where is_active and kind = 'section'),
m as (
  select e.id,
    -- 1) แผนกตรง **และอยู่ใต้ฝ่ายเดียวกัน** ← ตัวนี้แก้เคสชื่อแผนกซ้ำ (`ทั่วไป`)
    (select d.id from dept d where d.name = e.department and d.sec_name is not distinct from e.section) as by_dept_sec,
    -- 2) แผนกตรง และชื่อนั้นไม่ซ้ำทั้งผัง (ไม่กำกวม เชื่อได้)
    (select d.id from dept d where d.name = e.department
       and (select count(*) from dept d2 where d2.name = e.department) = 1)                             as by_dept_uniq,
    -- 3) ได้แค่ฝ่าย — ไม่ผิด แค่หยาบ (ต้องมีคนมาชี้แผนกทีหลัง)
    (select s.id from sec s where s.name = e.section)                                                   as by_sec
  from public.employees e)
update public.employees e
   set org_node_id  = coalesce(m.by_dept_sec, m.by_dept_uniq, m.by_sec),
       org_node_src = case when coalesce(m.by_dept_sec, m.by_dept_uniq) is not null then 'auto_dept'
                           when m.by_sec is not null                                then 'auto_section'
                      end
  from m
 where e.id = m.id
   and e.org_node_id is null                                   -- ไม่ทับของที่คนตั้งไว้แล้ว
   and coalesce(m.by_dept_sec, m.by_dept_uniq, m.by_sec) is not null;

-- ══════════════════════════════════════════════════════════════════
-- 3) backfill profiles — บัญชีของคน = ตามตัวคน · บัญชีกลาง = ตามฝ่ายที่ตั้งไว้
-- ══════════════════════════════════════════════════════════════════
update public.profiles p
   set org_node_id = e.org_node_id
  from public.employees e
 where p.employee_id = e.id and p.org_node_id is null and e.org_node_id is not null;

update public.profiles p
   set org_node_id = s.id
  from public.org_nodes s
 where s.is_active and s.kind = 'section' and s.name = p.section
   and p.org_node_id is null;
