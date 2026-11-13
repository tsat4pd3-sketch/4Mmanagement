-- 20261027_qa_inspector_scopes_main.sql · ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- 🔬 "QC คนนี้ตรวจคุณภาพให้หน่วยไหน" — แยก QA ออกจากผลิต (คำสั่ง user 2026-10-26)
--   > *"QA ที่มาอยู่กับผลิต คือต้องอยู่ส่วน QA แต่หน้างาน ตรวจคุณภาพให้ไลน์ไหน
--   >  ไม่ควรขึ้นกับผลิตรึป่าว"* → **ใช่** · ยืนยันอีกข้อ: *"QA ต้องเห็นทั้งโรงงานในเรื่องของคุณภาพ"*
--
-- ── สิ่งที่ตรวจเจอจากฐานจริง (26/10) ───────────────────────────────────────────────────
--   · ทะเบียน**คน** ถูกอยู่แล้ว: QC 23 คน `employees.section='QA'` · `line_id` ว่างทุกคน ✅
--   · ฝั่ง**บัญชี**ผิด: 13 บัญชี role `qa` มี `profiles.section='PD3'` (ฝ่ายผลิต)
--   · "ตรวจให้ไลน์ไหน" ถูกยัดไว้ใน `profiles.sections` (`['PD3']` / `['PD3','PD4']`)
--     ซึ่งเป็นช่อง**ขอบเขตที่เห็น** — และพอ `scope_depth='all'` ค่านั้นถูก override เป็น "เห็นทุกส่วน"
--     ⇒ **ข้อมูล "ตรวจให้หน่วยไหน" ไม่มีที่อยู่จริงในระบบเลย**
--
-- ── 🔴 แกนที่ 3 ต้องแยกจาก 2 แกนเดิม (หลักเดียวกับ `line_technicians` / `employee_flex_units`) ──
--   | คำถาม                | เก็บที่                                   |
--   | สังกัดใคร (บ้านจริง) | `employees.section` = QA · `profiles.section` |
--   | เห็นแค่ไหน           | `profiles.scope_depth` = `all` (ทั้งโรงงาน)  |
--   | **ตรวจให้หน่วยไหน**  | **ตารางนี้**                               |
--   🔴 **อ้างอิงเท่านั้น — ไม่ใช่การย้ายสังกัด** · ห้ามเอาไปแตะ `employees.section`/`org_node_id`/
--      `cost_center` · ห้ามเอาไปนับเป็นกำลังคนของไลน์ (QC ไม่ใช่กำลังคนหน้าไลน์ · `staff_kind='support'`)
--   🔴 **ไม่ใช่ด่านสิทธิ์** — role `qa` ถือคีย์ `scope:all_units` อยู่แล้ว (ตั้งใจ ตามคำสั่ง user ข้อ 3)
--      ตารางนี้ตอบว่า "ใครรับผิดชอบไลน์ไหน" เพื่อ**มอบหมายงาน/แจ้งเตือน/รายงาน** ไม่ได้ไปจำกัดการเขียน
--
-- `org_node_id` (ไม่ใช่ `line_id`) เพราะผังเก็บทั้งส่วนงาน/แผนก/กลุ่ม(ไลน์) ในตารางเดียว
--   ⇒ ตั้งได้ทั้ง "ทั้งส่วน PD3" และ "เฉพาะกลุ่ม LINE APRON ASSY" โดยไม่ต้องมี 2 ตาราง
--   ⇒ และ backfill จาก `profiles.sections` ที่มีอยู่ (ระดับส่วนงาน) ได้ตรงๆ ไม่ต้องเดาไลน์แทนคน
--
-- สิทธิ์: คีย์เดิม `qa:manage` (admin · manager · qa) — ไม่ seed คีย์ใหม่ · policy ผ่าน `has_perm()`
-- backward-compatible: ตารางใหม่ล้วน · ตารางว่าง = ไม่มีจอไหนเปลี่ยนพฤติกรรม
--
-- ⚠️ apply ผ่าน MCP ต้องแยกก้อน (MCP rollback ทั้ง migration ถ้าก้อนนั้นมี delete/drop)
--    ก้อน (ก) table+index+RLS+trigger · ก้อน (ข) policy ล้วน · ก้อน (ค) backfill
--
-- rollback (ย้อนโค้ดก่อน แล้วรันใน SQL Editor — MCP สั่ง drop ไม่ได้):
--   drop table if exists public.qa_inspector_scopes;
--   -- คืน profiles.section ของ 13 บัญชี (ถ้าต้องการ — ไม่มีผลกับสิทธิ์ ดูหมายเหตุก้อน ง):
--   -- update public.profiles set section='PD3' where role='qa' and section='QA';
begin;

create table if not exists public.qa_inspector_scopes (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  org_node_id uuid not null references public.org_nodes(id) on delete cascade,  -- หน่วยที่รับตรวจ
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, org_node_id)
);
create index if not exists qa_inspector_scopes_node_idx on public.qa_inspector_scopes (org_node_id);

comment on table public.qa_inspector_scopes is
  'QC หน้างานคนนี้ตรวจคุณภาพให้หน่วยไหน (ส่วนงาน/แผนก/กลุ่ม) — อ้างอิงเท่านั้น: '
  'สังกัดจริงยังอยู่ที่ employees.section = QA และไม่นับเป็นกำลังคนของไลน์ '
  '· ไม่ใช่ด่านสิทธิ์ (role qa ถือ scope:all_units) · ตั้งที่ /qa-setup?tab=inspectors '
  '· กฎใน src/utils/qaScope.js';

alter table public.qa_inspector_scopes enable row level security;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.qa_inspector_scopes;
    create trigger trg_set_updated_at before update on public.qa_inspector_scopes
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.qa_inspector_scopes;
    create trigger trg_audit after insert or update or delete on public.qa_inspector_scopes
      for each row execute function public.fn_audit();
  end if;
end $$;

commit;

-- ── ก้อน (ข) — policy ล้วน ─────────────────────────────────────────────────────────────
-- อ่านได้ทุกบัญชีที่ login (จอมอบหมายงาน/รายงานคุณภาพต้องรู้ว่าใครดูแลไลน์ไหน)
create policy qis_read  on public.qa_inspector_scopes for select to authenticated using (true);
create policy qis_write on public.qa_inspector_scopes for all to authenticated
  using (has_perm('qa:manage')) with check (has_perm('qa:manage'));

-- ── ก้อน (ค) — backfill จาก `profiles.sections` ของบัญชี role=qa ที่ผูกพนักงานแล้ว ────────
-- `sections` เก็บ code หรือ name ของส่วนงาน ⇒ จับคู่ทั้ง 2 ทาง · หาไม่เจอ = ข้าม (ไม่เดาแทนคน)
insert into public.qa_inspector_scopes (employee_id, org_node_id, note)
select p.employee_id, n.id, 'backfill 27/10 จาก profiles.sections'
from public.profiles p
cross join lateral unnest(coalesce(p.sections, '{}')) as s(sec)
join public.org_nodes n
  on n.kind = 'section' and n.is_active
 and (lower(btrim(n.code)) = lower(btrim(s.sec)) or lower(btrim(n.name)) = lower(btrim(s.sec)))
where p.role = 'qa' and p.employee_id is not null
on conflict (employee_id, org_node_id) do nothing;

-- ── ก้อน (ง) — บ้านจริงของบัญชี QC ต้องตรงกับทะเบียนพนักงาน ────────────────────────────
-- ⚠️ ไม่มีผลกับสิทธิ์: `UserContext.section` อ่านจาก `employees.section` (ชนะ profiles · App.jsx)
--    และ role `qa` ถือ `scope:all_units` อยู่แล้ว ⇒ นี่คือการล้างข้อมูลที่ขัดกันให้ตรงกัน
update public.profiles p
set section = e.section
from public.employees e
where p.employee_id = e.id and p.role = 'qa'
  and e.section is not null
  and coalesce(p.section,'') is distinct from e.section;
