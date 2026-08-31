-- ============================================================================
-- ชั้น "ฝ่าย" (division) ในผังองค์กร + ขอบเขตสกิล 2 ระดับ (2026-08-18 · คำสั่ง user)
--
-- ที่มา: user รายงานว่าช่างแผนก MTN เปิดโมดัลแก้ไขพนักงานแล้วเจอสกิลฝ่ายผลิต 29 ตัว
--   ขึ้น "ไม่เกี่ยวข้อง" → ขอให้ "แยกสกิลตามฝ่าย เช่น ฝ่ายผลิต/ฝ่ายช่าง แล้วค่อยเจาะจง
--   ได้ว่าสกิลนี้ของฝ่ายผลิตและใช้เฉพาะ PD3"
--
-- ── ปัญหาเดิม ───────────────────────────────────────────────────────────────
--   `skill_definitions.scope_section` มีระดับเดียว (PD3/PD4) → บอก "ของฝ่ายผลิตทั้งฝ่าย" ไม่ได้
--   ผลจริง: PD1 (32 คน) กับ PD2 (35 คน) ไม่มีสกิลไหน scope ถึงเลย ทั้งที่ใช้สกิล PD3/PD4 อยู่จริง
--   (PD2 31 คนถือสกิล PD3 93 แถว · PD4 31 คนถือสกิล PD3 77 แถว)
--
-- ── โครงที่เลือก (user เลือกเอง: "ติดป้ายฝ่ายที่ผังองค์กร") ──────────────────
--   ผังปัจจุบันไม่มีชั้นฝ่าย: ระดับบนสุดคือ **ส่วนงาน** (PD1-4, Planning&Store)
--   กับ **แผนกขึ้นตรงฝ่าย** (MTN, JIG MTN, DIE MTN, QA)
--   → **ไม่เพิ่มชั้นใหม่ในต้นไม้** (จะไปพัง cascade section→department ทุกหน้า)
--     แต่ **ติดป้าย `division` ที่ node ระดับบนสุด** แล้วให้ลูกตกทอดขึ้นไปหา
--     (หลักเดียวกับ cost_center / head_name ที่ไลน์ลูกตกทอดจากไลน์แม่)
--
-- ── ขอบเขตสกิล 2 ระดับ ──────────────────────────────────────────────────────
--   `scope_division` ว่าง → ทุกฝ่าย (สกิลกลาง)
--   `scope_division` = production → ทุกส่วนงานในฝ่ายผลิต
--   `scope_division` = production + `scope_section` = PD3 → เฉพาะ PD3
--   ⚠️ `scope_section` ที่ไม่มี `scope_division` ยังทำงานเหมือนเดิม (backward-compatible)
--
-- ⚠️ seed แบบอนุรักษ์นิยม: สกิลที่ scope PD3/PD4 อยู่แล้ว **คงเจาะจงส่วนงานเหมือนเดิม**
--    แค่ติดป้ายว่าเป็นฝ่ายผลิต — ถ้าอยากให้กว้างขึ้นทั้งฝ่าย ให้ล้างช่องส่วนงานเอง
--    (เป็นการตัดสินใจของหน้างานว่าสกิลไหนใช้ร่วมทั้งฝ่ายได้ ระบบไม่เดาให้)
--
-- ROLLBACK:
--   alter table public.skill_definitions drop column if exists scope_division;
--   alter table public.org_nodes         drop column if exists division;
--   drop table if exists public.org_divisions;
-- ============================================================================

-- ── master ฝ่าย (data-driven — เพิ่ม/แก้ฝ่ายได้โดยไม่ต้องแก้โค้ด) ─────────────
create table if not exists public.org_divisions (
  code        text primary key,
  label       text not null,
  icon        text,
  color       text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.org_divisions (code, label, icon, color, sort_order) values
  ('production',  'ฝ่ายผลิต',        '🏭', '#22c55e', 10),
  ('maintenance', 'ฝ่ายช่าง',        '🔧', '#f97316', 20),
  ('quality',     'ฝ่ายคุณภาพ',      '✅', '#3b82f6', 30),
  ('logistic',    'ฝ่ายวางแผน-คลัง', '📦', '#a855f7', 40),
  ('office',      'ฝ่ายสำนักงาน',    '🗂️', '#94a3b8', 50)
on conflict (code) do nothing;

alter table public.org_divisions enable row level security;
drop policy if exists org_divisions_read on public.org_divisions;
create policy org_divisions_read  on public.org_divisions for select to authenticated using (true);
drop policy if exists org_divisions_write on public.org_divisions;
create policy org_divisions_write on public.org_divisions for all to authenticated
  using (has_perm('org:manage_divisions')) with check (has_perm('org:manage_divisions'));

-- ── ติดป้ายฝ่ายให้ node ในผัง (ลูกตกทอดจากแม่ ไม่ต้องติดทุกตัว) ──────────────
alter table public.org_nodes add column if not exists division text;
do $$ begin
  alter table public.org_nodes
    add constraint org_nodes_division_fk foreign key (division)
    references public.org_divisions(code) on update cascade on delete set null;
exception when duplicate_object then null; end $$;

alter table public.skill_definitions add column if not exists scope_division text;
do $$ begin
  alter table public.skill_definitions
    add constraint skill_definitions_scope_division_fk foreign key (scope_division)
    references public.org_divisions(code) on update cascade on delete set null;
exception when duplicate_object then null; end $$;

-- ── seed ป้ายฝ่ายจากผังจริง (เฉพาะ node ระดับบนสุด — ที่เหลือตกทอด) ─────────
update public.org_nodes set division = 'production'
 where kind = 'section' and parent_id is null and name in ('PD1','PD2','PD3','PD4') and division is null;

update public.org_nodes set division = 'logistic'
 where kind = 'section' and parent_id is null and name = 'Planning&Store' and division is null;

update public.org_nodes set division = 'maintenance'
 where kind = 'department' and parent_id is null and name in ('MTN','JIG MTN','DIE MTN') and division is null;

update public.org_nodes set division = 'quality'
 where kind = 'department' and parent_id is null and name = 'QA' and division is null;

-- ── สกิลที่เจาะจงส่วนงานผลิตอยู่แล้ว = สกิลฝ่ายผลิต (ยังเจาะจงส่วนงานเหมือนเดิม) ──
update public.skill_definitions sd set scope_division = 'production'
 where sd.scope_division is null
   and exists (
     select 1 from public.org_nodes n
      where n.kind = 'section'
        and lower(btrim(coalesce(n.code, n.name))) = lower(btrim(sd.scope_section))
        and n.division = 'production'
   );

-- ── สิทธิ์จัดการฝ่าย + audit ────────────────────────────────────────────────
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'org', 'manage_divisions', 'ผังองค์กร: จัดการฝ่าย (division)', 'ตั้งค่า/ฐานข้อมูล', 900
where not exists (select 1 from public.permission_catalog where resource='org' and action='manage_divisions');

insert into public.role_permissions (role, permission_key, allowed)
select r, 'org:manage_divisions', r in ('admin'::user_role, 'manager'::user_role)
  from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do update set allowed = excluded.allowed;

drop trigger if exists trg_audit_org_divisions on public.org_divisions;
create trigger trg_audit_org_divisions after insert or update or delete
  on public.org_divisions for each row execute function public.fn_audit();
drop trigger if exists trg_updated_at_org_divisions on public.org_divisions;
create trigger trg_updated_at_org_divisions before update
  on public.org_divisions for each row execute function public.fn_set_updated_at();
