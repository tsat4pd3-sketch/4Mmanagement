-- ─────────────────────────────────────────────────────────────────────────────
-- 👥 ทะเบียนคนครอบคลุม "พนักงานทางอ้อม" ด้วย — `employees.staff_kind`   (Main project)
-- 2026-09-21 · user เคาะทางเลือก A ใน docs/IDENTITY-NOTIFY-DESIGN.md §5
--
-- ── ปัญหา (วัดจริง 18/09) ───────────────────────────────────────────────────
--   `employees` active 212 คน = **สายผลิต + ช่าง ล้วน** ไม่มี QA/PE/ธุรการ/สโตร์เลยสักคน
--   ⇒ บัญชี 30 ใบ (32%) ผูกตัวตนไม่ได้เพราะ "ตัวคนไม่มีในทะเบียน"
--   ⇒ admin กดปุ่มเดียวที่กดได้คือ "บัญชีหน่วยงาน/อุปกรณ์" → **32 บัญชีของคนจริงถูกติดป้าย `shared`**
--      (QC 14 คน · หัวหน้าแผนก 3 · วิศวกร 1 · ผช.ช่างเทคนิค 2 · หัวหน้าไลน์ 3 · ธุรการ 1)
--   ⇒ ตัวกรอง "แผนก" ของแจ้งเตือนเดินผ่าน employee_id ⇒ 73/94 บัญชี (78%) ตั้งไปก็ไม่มีผล
--
-- ── ทางแก้ ──────────────────────────────────────────────────────────────────
--   `employees` = **ทะเบียนคนของทั้งบริษัท** (ไม่ใช่แค่คนหน้าไลน์) + ธงบอกว่าเป็นคนกลุ่มไหน
--     `direct`   = พนักงานหน้าไลน์/ช่าง — เช็คชื่อ · มีสกิล · นับเป็นกำลังคน
--     `indirect` = สายสนับสนุน (QA/PE/ธุรการ/สโตร์/เซลล์) — **ไม่เช็คชื่อ ไม่นับกำลังคน**
--
-- ⚠️ **แถวเดิมทั้ง 212 คน = `direct` อัตโนมัติ ⇒ วันที่ apply ไม่มีตัวเลขไหนขยับแม้แต่นิดเดียว**
--    (กำลังคน · เข้างาน · turnover · OEE manpower เท่าเดิมเป๊ะ)
--
-- ⚠️ **ลำดับบังคับ: จอที่นับคนต้องกรอง `indirect` ออกให้ครบก่อน แล้วค่อยคีย์คนทางอ้อมเข้าระบบ**
--    (ดู `src/utils/staffKind.js` + เทสใน regressionGuards) — สลับลำดับ = ตัวเลขกำลังคนเฟ้อเงียบๆ
--
-- ── ส่วนที่ 2: ผูกบัญชีที่ "ชื่อตรงกับฐานพนักงานอยู่แล้ว" คืน ────────────────
--   15 บัญชีนี้ถูกติดป้าย `shared`/ยังไม่ระบุ ทั้งที่มีตัวตนในทะเบียนอยู่แล้ว
--   (หาไม่เจอตอนสร้างเพราะช่องค้นไม่ตัดช่องว่างซ้ำ — ชื่อพิมพ์ 2 เคาะ เช่น `ชญาดา  บัวแดง`)
--   ⇒ จับคู่ด้วยชื่อที่ **ตัดช่องว่างทั้งหมดออกแล้ว** และต้องเป็น **1:1 ทั้งสองทาง** เท่านั้น
--     (ตรวจแล้ว 21/09: ทั้ง 15 คู่เป็น 1:1 ไม่มีกำกวม — ชื่อซ้ำ/กำกวมจะไม่ถูกแตะ ปล่อยให้คนตัดสิน)
--
-- ⚠️ ไม่กระทบพฤติกรรมวันนี้: ตัวกรอง "แผนก" ของแจ้งเตือน **ยังไม่มีกฎไหนใช้เลย (0/61)**
--    การผูกจึงเป็นการ "เติมตัวตน" ล้วนๆ · `profiles.team/line_id/section` ไม่ถูกแตะ
--
-- ROLLBACK:
--   update profiles set employee_id = null, account_kind = 'shared'
--    where id in (select profile_id from bk_profile_emp_link_20260921);
--   alter table employees drop column if exists staff_kind;
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════
-- 1) ธงประเภทพนักงาน
-- ══════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists staff_kind text not null default 'direct';

do $$ begin
  alter table public.employees
    add constraint employees_staff_kind_chk check (staff_kind in ('direct', 'indirect'));
exception when duplicate_object then null; end $$;

comment on column public.employees.staff_kind is
  'direct = พนักงานหน้าไลน์/ช่าง (เช็คชื่อ · มีสกิล · นับกำลังคน) · indirect = สายสนับสนุน QA/PE/ธุรการ/สโตร์ (ไม่เช็คชื่อ ไม่นับกำลังคน) — จอที่นับคนต้องกรองผ่าน src/utils/staffKind.js เท่านั้น';

create index if not exists employees_staff_kind_idx
  on public.employees(staff_kind) where staff_kind <> 'direct';

-- ══════════════════════════════════════════════════════════════════
-- 2) ผูกบัญชีคืน (เฉพาะที่ชื่อตรงแบบ 1:1 ทั้งสองทาง)
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.bk_profile_emp_link_20260921 (
  profile_id uuid primary key,
  full_name  text,
  old_kind   text,
  new_emp_id uuid,
  linked_at  timestamptz not null default now()
);

with n as (
  select p.id pid, p.full_name, p.account_kind,
         lower(regexp_replace(coalesce(p.full_name, ''), '\s+', '', 'g')) k
    from public.profiles p
   where p.employee_id is null),
e as (
  select id eid, lower(regexp_replace(coalesce(name, ''), '\s+', '', 'g')) k
    from public.employees
   where is_active
     and id not in (select employee_id from public.profiles where employee_id is not null)),
m as (
  select n.pid, n.full_name, n.account_kind, e.eid,
         count(*) over (partition by n.pid) emp_per_profile,
         count(*) over (partition by e.eid) profile_per_emp
    from n join e on e.k = n.k)
insert into public.bk_profile_emp_link_20260921 (profile_id, full_name, old_kind, new_emp_id)
select pid, full_name, account_kind, eid
  from m
 where emp_per_profile = 1 and profile_per_emp = 1   -- 1:1 เท่านั้น · กำกวม = ไม่แตะ
on conflict (profile_id) do nothing;

update public.profiles p
   set employee_id  = b.new_emp_id,
       account_kind = 'person'
  from public.bk_profile_emp_link_20260921 b
 where p.id = b.profile_id
   and p.employee_id is null;
