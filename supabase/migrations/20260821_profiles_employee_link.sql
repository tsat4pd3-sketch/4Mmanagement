-- ============================================================================
-- ผูกบัญชี user เข้ากับตัวตนพนักงาน — single source of truth (2026-08-21 · คำสั่ง user)
--
-- ── ปัญหา ───────────────────────────────────────────────────────────────────
--   ตัวตนของคนคนเดียวถูกเก็บ 2 ที่ที่ไม่รู้จักกัน **ไม่มีคอลัมน์ผูกเลย**
--     `employees` : ทีม/ไลน์/ส่วนงาน/แผนก/ตำแหน่ง  ← หัวหน้าแผนกดูแล
--     `profiles`  : ทีม/ไลน์/ส่วนงาน/ตำแหน่ง (ซ้ำ) + role/สิทธิ์  ← admin กรอกเองตอนสร้าง user
--   → admin ไม่รู้ว่าหัวหน้าตั้งทีมอะไรไว้ กรอกไม่ตรง = คนละทีมกัน
--
--   เคสจริงที่เกิด (2026-08-21): หัวหน้า LINE APRON ASSY 2 คน **ทีมสลับกันพอดี**
--     กรกฎ แสงอาวุธ    บัญชี=B  ฐานพนักงาน=A
--     ชาญณรงค์ ยอดนนท์ บัญชี=A  ฐานพนักงาน=B
--   `Checkin.jsx` กรองรายชื่อด้วย `empQ.eq('team', team)` จาก **บัญชี** ตรงๆ
--   → เปิดหน้าเช็คชื่อแล้ว "มองไม่เห็นกะตัวเอง" เห็นของอีกคนแทน
--
--   วัดทั้งระบบ: จับคู่ชื่อได้ 13/71 บัญชี · ในนั้นเพี้ยน 6 · ช่าง 25 คนจับคู่ไม่ได้เลย
--
-- ── ทางแก้ ──────────────────────────────────────────────────────────────────
--   เติม `profiles.employee_id` = ตัวผูกที่ขาดไป → ฐานพนักงานเป็นเจ้าของตัวตน
--
-- ⚠️ **บัญชีบางตัวไม่ใช่คน ห้ามบังคับให้ผูก** (user ยืนยัน 2026-08-21)
--    บัญชีของหน่วยงาน/อุปกรณ์: maintenance · jigmaintenance · warehouse1 · delivery1 ·
--    billing · Display · ADMIN → ไม่มีตัวตนใน employees และไม่ควรมี
--    → `employee_id` nullable + `account_kind` แยกให้ชัดว่าเป็นบัญชีแบบไหน
--
-- ⚠️ **ระบบไม่เดาว่าบัญชีไหนเป็นของคน/ของหน่วยงาน** — เดาผิดแล้วเงียบกว่าเดิม
--    บัญชีที่จับคู่ชื่อได้ชัดเจนตัวเดียว = ผูกให้ + ตั้ง 'person'
--    ที่เหลือปล่อย `account_kind` เป็น null = "ยังไม่ระบุ" ขึ้นเป็น worklist ให้ admin จัด
--    (หลักเดียวกับ backfill ทะเบียนแม่พิมพ์: แกะไม่ออกปล่อยว่าง ห้ามเดา)
--
-- ⚠️ migration นี้ **ไม่แตะ** profiles.team/line_id/section — ยังเป็นตัวที่ระบบใช้อยู่
--    การย้าย read path ไปอ่านจาก employees เป็นคนละก้อน (แตะ scoping ทั้งระบบ)
--    → ขั้นนี้จึงไม่เปลี่ยนพฤติกรรมของใครเลย ปลอดภัยต่อการ deploy
--
-- ROLLBACK:
--   alter table public.profiles drop column if exists employee_id;
--   alter table public.profiles drop column if exists account_kind;
-- ============================================================================

alter table public.profiles add column if not exists employee_id uuid;
do $$ begin
  alter table public.profiles
    add constraint profiles_employee_fk foreign key (employee_id)
    references public.employees(id) on delete set null;
exception when duplicate_object then null; end $$;

-- 1 พนักงาน = 1 บัญชี (กันผูกซ้ำคนเดียวหลายบัญชีโดยไม่ตั้งใจ)
create unique index if not exists profiles_employee_id_uniq
  on public.profiles(employee_id) where employee_id is not null;

alter table public.profiles add column if not exists account_kind text;
do $$ begin
  alter table public.profiles
    add constraint profiles_account_kind_chk
    check (account_kind is null or account_kind in ('person','shared'));
exception when duplicate_object then null; end $$;

comment on column public.profiles.employee_id is
  'ตัวตนพนักงานของบัญชีนี้ (single source of truth ของ ทีม/ไลน์/ส่วนงาน) · null = บัญชีหน่วยงาน/อุปกรณ์';
comment on column public.profiles.account_kind is
  'person = บัญชีของคน ต้องผูก employee_id · shared = บัญชีหน่วยงาน/อุปกรณ์ ไม่ต้องผูก · null = ยังไม่ระบุ (worklist)';

-- ── ผูกอัตโนมัติเฉพาะที่ชื่อตรงกันแบบ "ชัดเจนตัวเดียว" ──────────────────────
--    ชื่อซ้ำ/กำกวม = ไม่ผูก ปล่อยให้คนตัดสิน (ผูกผิดคน = ข้อมูลเท็จที่ดูน่าเชื่อ)
with cand as (
  select p.id as pid, min(e.id::text)::uuid as eid, count(*) as n
    from public.profiles p
    join public.employees e
      on lower(btrim(e.name)) = lower(btrim(p.full_name)) and e.is_active
   where p.employee_id is null
   group by p.id
)
update public.profiles p
   set employee_id = c.eid,
       account_kind = coalesce(p.account_kind, 'person')
  from cand c
 where p.id = c.pid and c.n = 1;
