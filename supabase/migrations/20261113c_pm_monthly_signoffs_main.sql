-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ✍️ ใบ PM ของช่าง — ลงนามรายเดือน ขั้น ③ / ④ (PM รอบ 2 · 2026-11-13 · คำสั่ง user)
-- Project: **Main** (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)
--
-- สายใบ PM: ① ผู้ตรวจ (สแกนบัตร) → ② หัวหน้าผู้ตรวจยืนยันทีละใบ (inspections ฝั่ง DR · รอบ 1)
--           → ③ ผจก.ส่วนของผู้ตรวจ **อนุมัติผลตรวจ** รายเดือน ต่อ "ทีมช่าง"     (kind='team_approve' · scope_key = คีย์ทีม)
--           → ④ ผจก.ส่วนที่ถูกตรวจ **รับทราบผลตรวจ** รายเดือน ต่อ "ส่วนงาน"   (kind='section_ack'  · scope_key = ชื่อส่วนงาน)
-- ทำไม Main: ลายเซ็นต้องผูกตัวคนที่ login (auth.uid() + has_perm) — supabaseDR เป็น anon เสมอ
-- ต้นแบบ: am_monthly_signoffs (20261103) — ลงนาม = บันทึก (snapshot) · ห้ามลบ · เพิกถอน = revoked + เหตุผล
-- คีย์สิทธิ์: pm:monthly_approve (③) · pm:monthly_ack (④) — seed admin · manager · mtn (③ เท่านั้น — ผจก.ช่างบางคน role=mtn)
--   ตำแหน่ง ≥ ผู้จัดการ + ทีม/ส่วนงานที่ดูแล + ไม่ใช่บัญชีกลาง ตัดสินที่ client (`pmMonthlyVerdict`) · ฐานคุม "ใคร" + "คีย์ตาม kind"
-- ✅ apply แล้ว 2026-11-13 ผ่าน MCP · ทดสอบ RLS: ผจก. ลงนามได้ · หัวหน้าแผนก/ลงนามในชื่อคนอื่น = ถูกปฏิเสธ
-- ✅ backward-compatible: ตารางใหม่ล้วน · ก่อน apply จอเขียนบอก "ระบบลงนามยังไม่เปิดใช้"
-- ↩️ rollback (ย้อนโค้ดก่อน แล้วรันใน SQL Editor "MAIN"):
--    drop table if exists public.pm_monthly_signoffs;
--    drop function if exists public.fn_pm_monthly_signoff_guard();
--    delete from public.role_permissions where permission_key in ('pm:monthly_approve','pm:monthly_ack');
--    delete from public.permission_catalog where resource = 'pm' and action in ('monthly_approve','monthly_ack');
--    delete from public.doc_forms where doc_key = 'xlsx_pm_monthly';
-- ════════════════════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.pm_monthly_signoffs (
  id              uuid primary key default gen_random_uuid(),
  month           text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kind            text not null check (kind in ('team_approve', 'section_ack')),
  scope_key       text not null check (btrim(scope_key) <> ''),
  snapshot        jsonb not null,
  signed_by       uuid not null default auth.uid(),
  signed_by_name  text,
  position        text,
  position_rank   int,
  signature_url   text,
  signed_at       timestamptz not null default now(),
  note            text,
  status          text not null default 'signed' check (status in ('signed', 'revoked')),
  revoked_by      uuid,
  revoked_by_name text,
  revoked_at      timestamptz,
  revoke_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pm_monthly_signoffs_revoke_ck check (
    status = 'signed'
    or (revoked_at is not null and revoked_by is not null and length(btrim(coalesce(revoke_reason, ''))) >= 5)
  )
);

create unique index if not exists pm_monthly_signoffs_active_uq
  on public.pm_monthly_signoffs (month, kind, scope_key) where status = 'signed';
create index if not exists pm_monthly_signoffs_month_idx on public.pm_monthly_signoffs (month);

comment on table public.pm_monthly_signoffs is
  'ใบ PM ช่าง ลงนามรายเดือน: team_approve = ③ ผจก.ส่วนของผู้ตรวจอนุมัติ (scope=ทีม) · section_ack = ④ ผจก.ส่วนที่ถูกตรวจรับทราบ (scope=ส่วนงาน) · '
  'ห้ามลบ เพิกถอน = revoked + เหตุผล · โค้ด src/lib/pmMonthlySignoff.js';

create or replace function public.fn_pm_monthly_signoff_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'revoked' then
    raise exception 'pm_monthly_signoffs: ลายเซ็นที่เพิกถอนแล้วแก้ไม่ได้';
  end if;
  if new.month is distinct from old.month or new.kind is distinct from old.kind or new.scope_key is distinct from old.scope_key
     or new.snapshot is distinct from old.snapshot
     or new.signed_by is distinct from old.signed_by or new.signed_by_name is distinct from old.signed_by_name
     or new.position is distinct from old.position or new.position_rank is distinct from old.position_rank
     or new.signature_url is distinct from old.signature_url or new.signed_at is distinct from old.signed_at
     or new.note is distinct from old.note then
    raise exception 'pm_monthly_signoffs: เนื้อลายเซ็นแก้ไม่ได้ — เพิกถอนแล้วลงนามใหม่';
  end if;
  if new.status = 'revoked' then
    new.revoked_by := auth.uid();
    new.revoked_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_pm_monthly_signoff_guard on public.pm_monthly_signoffs;
create trigger trg_pm_monthly_signoff_guard before update on public.pm_monthly_signoffs
  for each row execute function public.fn_pm_monthly_signoff_guard();

alter table public.pm_monthly_signoffs enable row level security;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.pm_monthly_signoffs;
    create trigger trg_set_updated_at before update on public.pm_monthly_signoffs
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.pm_monthly_signoffs;
    create trigger trg_audit after insert or update or delete on public.pm_monthly_signoffs
      for each row execute function public.fn_audit();
  end if;
end $$;

drop policy if exists pms_read on public.pm_monthly_signoffs;
create policy pms_read on public.pm_monthly_signoffs for select to authenticated using (true);

drop policy if exists pms_insert on public.pm_monthly_signoffs;
create policy pms_insert on public.pm_monthly_signoffs for insert to authenticated
  with check (
    signed_by = (select auth.uid()) and status = 'signed'
    and ((kind = 'team_approve' and (select public.has_perm('pm:monthly_approve')))
      or (kind = 'section_ack'  and (select public.has_perm('pm:monthly_ack'))))
  );

drop policy if exists pms_revoke on public.pm_monthly_signoffs;
create policy pms_revoke on public.pm_monthly_signoffs for update to authenticated
  using (status = 'signed'
    and ((kind = 'team_approve' and (select public.has_perm('pm:monthly_approve')))
      or (kind = 'section_ack'  and (select public.has_perm('pm:monthly_ack')))))
  with check (status = 'revoked'
    and ((kind = 'team_approve' and (select public.has_perm('pm:monthly_approve')))
      or (kind = 'section_ack'  and (select public.has_perm('pm:monthly_ack')))));

revoke all on public.pm_monthly_signoffs from anon;
grant select, insert, update on public.pm_monthly_signoffs to authenticated;
revoke delete, truncate, references, trigger on public.pm_monthly_signoffs from authenticated;

insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('pm', 'monthly_approve', 'PM: อนุมัติผลตรวจรายเดือน (ผจก.ส่วนของผู้ตรวจ · ขั้น 3)', 'การตรวจสอบและซ่อมบำรุง', 101),
  ('pm', 'monthly_ack',     'PM: รับทราบผลตรวจรายเดือน (ผจก.ส่วนที่ถูกตรวจ · ขั้น 4)', 'การตรวจสอบและซ่อมบำรุง', 102)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

insert into public.role_permissions (role, permission_key, allowed)
select r.role, r.k, true
from (values ('admin'::user_role, 'pm:monthly_approve'), ('manager'::user_role, 'pm:monthly_approve'), ('mtn'::user_role, 'pm:monthly_approve'),
             ('admin'::user_role, 'pm:monthly_ack'),     ('manager'::user_role, 'pm:monthly_ack')) as r(role, k)
where not exists (select 1 from public.role_permissions x where x.role = r.role and x.permission_key = r.k);

insert into public.doc_forms (doc_key, title, form_code) values
  ('xlsx_pm_monthly', 'สรุปผลตรวจ PM ช่าง รายเดือน (Excel)', null)
on conflict (doc_key) do nothing;

commit;

-- ── ตรวจผล ──
-- select policyname, cmd from pg_policies where tablename='pm_monthly_signoffs';
-- select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='pm_monthly_signoffs' order by 1,2;
-- select role, permission_key from role_permissions where permission_key like 'pm:monthly_%' order by 2,1;
-- select doc_key, form_code from doc_forms where doc_key='xlsx_pm_monthly';
