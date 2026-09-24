-- ─────────────────────────────────────────────────────────────────────────────
-- 👔 "ใครคุมหน่วยไหน" + รักษาการ — `org_assignments`            (Main project)
-- 2026-09-24 · หลักฐานจากผังจริง ORG-001 Rev.09 · docs/modules/org-hierarchy.md §8
--
-- ── ทำไมต้องมีตารางใหม่ (ไม่ยัดลง profiles) ─────────────────────────────────
-- ผังจริงพิสูจน์ 2 เรื่องที่โมเดลเดิมรับไม่ได้:
--   1. **7 จาก 14 ส่วน (50%) หัวหน้าเป็น "รักษาการ"** — ไม่ใช่เคสขอบ แต่เป็นสภาพปกติ
--   2. **คนเดียวคุมหลายหน่วยพร้อมกัน** — ศักดา = Press Production + Tooling MTN ·
--      ดุลยทรรศน์ = Hydroforming + Assembly 2
-- ⇒ `employees.org_node_id` (คอลัมน์เดียว) ตอบได้แค่ "สังกัดที่ไหน"
--   **"คุมหน่วยไหนบ้าง" เป็นคนละคำถาม และเป็นได้หลายค่า + มีวันหมดอายุ**
--
-- ── ⚖️ ไม่ขัดกับกฎ "ขอบเขตตัดให้แคบเท่านั้น ห้ามขยาย" ──────────────────────
-- (กฎใน docs/ACCESS-CONTROL-STANDARDS.md §2 — role-centric RBAC-A)
-- กฎนั้นห้าม **อนุมานสิทธิ์กว้างจากการเว้นว่าง** (fail-open) ซึ่งคนละเรื่องกับตารางนี้:
--   · ตารางนี้เป็น **ข้อมูลที่คนกรอกไว้ชัดเจน** ไม่ใช่การเดาจากช่องว่าง
--   · มันขยาย **ขอบเขต (เห็นที่ไหน)** ไม่ได้ขยาย **สิทธิ์ (ทำอะไรได้)** — เพดานยังเป็น role เหมือนเดิม
--   · และมี **วันหมดอายุ** ซึ่ง fail-open ไม่มี
--
-- ── 🔴 กติกาของตาราง ───────────────────────────────────────────────────────
--   · `kind='acting'` = รักษาการ — **ชั่วคราวโดยนิยาม**
--   · หมดอายุ = **คิดตอนอ่าน (ends_on < วันนี้)** ไม่มี cron ไปเขียนสถานะ
--     เพราะ cron ที่ไม่ได้รัน = สิทธิ์ค้างเงียบ (ซึ่งคือปัญหาที่ตารางนี้มาแก้)
--   · `ends_on` เป็น null ได้ **แต่สำหรับ acting = รายการที่ต้องตามเก็บ**
--     (ผังจริงไม่ได้เขียนวันสิ้นสุดไว้เลยสักใบ — นั่นคือตัวปัญหา ISO 27001 A.5.18 พูดถึงพอดี)
--     ⇒ **ห้าม default วันสิ้นสุดให้เอง** เดาวันหมดอายุ = สร้างข้อมูลเท็จ
--   · `confirmed_at` null = ระบบใส่ให้จากผัง **ยังไม่มีคนยืนยัน**
--
-- ⚠️ **ขั้นนี้ยังไม่มีจอไหนเอาไปคิดขอบเขตจริง** — เก็บ + แสดง + เตือนเท่านั้น
--    การต่อสายเข้าตัวคำนวณขอบเขต ทำพร้อมกับ `scope_depth` ครั้งเดียว
--    (ต้องพิสูจน์ผลเทียบเก่า-ใหม่ครบทุกบัญชีก่อน — ORG-AXES-DECISION §7.6)
--
-- ROLLBACK: drop table if exists public.org_assignments;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.org_assignments (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id)  on delete cascade,
  org_node_id  uuid not null references public.org_nodes(id) on delete cascade,
  kind         text not null default 'head',     -- head = หัวหน้าตัวจริง · acting = รักษาการ
  scope_depth  text,                             -- ขอบเขตที่ได้จากการคุมหน่วยนี้ (null = ตามค่าของบัญชี)
  starts_on    date,
  ends_on      date,                             -- null = ยังไม่กำหนด (acting แบบนี้ = ต้องตามเก็บ)
  note         text,
  source       text not null default 'manual',   -- manual | org_chart_rev09
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);

do $$ begin
  alter table public.org_assignments add constraint org_assignments_kind_chk
    check (kind in ('head', 'acting'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.org_assignments add constraint org_assignments_depth_chk
    check (scope_depth is null or scope_depth in ('self', 'unit', 'branch', 'all'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- ช่วงวันต้องสมเหตุผล (เริ่มก่อนจบ) — กันคีย์สลับวันแล้วรายการหายจากทุกตัวกรองเงียบๆ
  alter table public.org_assignments add constraint org_assignments_range_chk
    check (starts_on is null or ends_on is null or starts_on <= ends_on);
exception when duplicate_object then null; end $$;

-- คนเดียวคุมหน่วยเดียวซ้ำ 2 บรรทัดในบทบาทเดียวกันไม่ได้ (แต่คุมหลายหน่วยได้)
create unique index if not exists org_assignments_uniq
  on public.org_assignments(profile_id, org_node_id, kind);
create index if not exists org_assignments_node_idx on public.org_assignments(org_node_id);
create index if not exists org_assignments_open_idx on public.org_assignments(kind)
  where kind = 'acting' and ends_on is null;

comment on table public.org_assignments is
  'ใครคุมหน่วยไหนในผังองค์กร (head/acting) — ตอบ "คุมอะไร" ซึ่งคนละคำถามกับ employees.org_node_id ที่ตอบ "สังกัดที่ไหน" · หมดอายุคิดตอนอ่าน ไม่มี cron · อ่านผ่าน src/utils/orgAssignments.js';
comment on column public.org_assignments.ends_on is
  'null = ยังไม่กำหนดวันสิ้นสุด — สำหรับ kind=acting คือรายการที่ต้องตามเก็บ (ISO 27001 A.5.18) **ห้ามใส่วันให้เองโดยการเดา**';
comment on column public.org_assignments.source is
  'org_chart_rev09 = ระบบใส่ให้จากผังองค์กรทางการ ยังไม่มีคนยืนยัน (confirmed_at null) · manual = คนกรอกเอง';

alter table public.org_assignments enable row level security;
do $$ begin
  create policy org_assignments_read on public.org_assignments
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy org_assignments_write on public.org_assignments
    for all to authenticated
    using (public.has_perm('org:manage')) with check (public.has_perm('org:manage'));
exception when duplicate_object then null; end $$;

-- ══════════════════════════════════════════════════════════════════
-- seed จากผังจริง — เฉพาะที่ **จับคู่ได้แน่นอน** (cost center ตรงเป๊ะ + ชื่อคนตรง)
--   ส่วนที่เหลือในผัง (Process Engineering · W/H&DEL · QSM · CIC · จัดซื้อ · HRM · บัญชี)
--   **ยังไม่มีโหนดในระบบ** จึง seed ไม่ได้ — ปล่อยให้คนเพิ่มจากจอ
--   ⚠️ ทุกแถวเป็น source='org_chart_rev09' + confirmed_at null = **ยังไม่มีคนยืนยัน**
--   ⚠️ ไม่ใส่ ends_on ให้เลย เพราะผังไม่ได้เขียนไว้ — นั่นคือสิ่งที่ต้องไปตามเก็บ
-- ══════════════════════════════════════════════════════════════════
insert into public.org_assignments (profile_id, org_node_id, kind, source, note)
select p.id, n.id, v.kind, 'org_chart_rev09', v.note
  from (values
    ('ศักดา กาละศรี',            'PD1', 'acting', 'ผังระบุ รก.ผู้จัดการ (S1)* — ส่วน Press Production'),
    ('ศิริพร แซ่ก๊วย',            'PD2', 'acting', 'ผังระบุ รก.ผู้จัดการ (S1)* — ส่วน Assembly 1'),
    ('ดุลยทรรศน์ ลาภธนสารสมบัติ', 'PD3', 'head',   'ผังระบุ ผู้จัดการ (M2) — ส่วน Hydroforming'),
    ('ดุลยทรรศน์ ลาภธนสารสมบัติ', 'PD4', 'head',   'ผังระบุ ผู้จัดการ (M2) — ส่วน Assembly 2 (GOR · LWRBAR)')
  ) as v(full_name, node_name, kind, note)
  join public.profiles  p on p.full_name = v.full_name
  join public.org_nodes n on n.name = v.node_name and n.kind = 'section' and n.is_active
on conflict do nothing;
