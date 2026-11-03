-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ✍️ ลงนามทบทวน AM รายเดือน — ขั้น 3 ของสาย AM (หัวหน้าแผนก/ส่วน) · 2026-11-03 (user ตัดสิน 03/11)
-- Project: **Main** (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)
--
-- สาย AM: พนักงานตรวจทุกต้นกะ → หัวหน้ากลุ่มรับทราบ (รายวัน · inspections ฝั่ง DR) → **หัวหน้าแผนก/ส่วนทบทวน (รายเดือน · ตารางนี้)**
-- ทำไมอยู่ Main ไม่ใช่ DR: ลายเซ็นต้องผูก "ตัวคนที่ login" (auth.uid() + has_perm) — supabaseDR เป็น anon เสมอ
--   ⇒ ฝั่ง DR ตรวจไม่ได้ว่าใครเซ็น · อ้างอิง line_name/month/shift เป็น text (ใบตรวจอยู่อีก project ผูก FK ไม่ได้)
-- โค้ด: src/lib/amMonthlySignoff.js (DB) · src/utils/amApproval.js (`amMonthlySignoffVerdict`) · src/components/AmMonthlyReport.jsx
--
-- 🔴 ลงนาม = บันทึก (หลักเดียวกับ prod_problem_reports): `snapshot` = สรุปของไลน์ ณ ตอนลงนาม · ห้ามลบ —
--    เพิกถอน = status 'revoked' + เหตุผล (ไม่มี policy/GRANT delete · trigger ล็อกเนื้อแถวที่ลงนามแล้ว)
-- สิทธิ์: คีย์ใหม่ `am:monthly_signoff` — seed เฉพาะ admin · manager · supervisor (ระดับหัวหน้าแผนก/ส่วนขึ้นไป)
--    ไม่ seed leader (หัวหน้ากลุ่ม = ขั้น 2) · ไม่ seed qa/mtn/engineer · ห้าม seed ด้วย enum_range
--    ตำแหน่ง ≥ หัวหน้าแผนก/ส่วน ตัดสินที่ client (`positionRank`) — ฐานคุม "ใคร" (has_perm + signed_by = auth.uid())
--
-- ✅ backward-compatible: ตารางใหม่ล้วน · ก่อน apply จอเขียนบอก "ระบบลงนามยังไม่เปิดใช้" (42P01/PGRST205) ไม่พัง
-- ↩️ rollback (ย้อนโค้ดก่อน แล้วรันใน SQL Editor):
--    drop table if exists public.am_monthly_signoffs;
--    drop function if exists public.fn_am_monthly_signoff_guard();
--    delete from public.role_permissions where permission_key = 'am:monthly_signoff';
--    delete from public.permission_catalog where resource = 'am' and action = 'monthly_signoff';
-- ════════════════════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.am_monthly_signoffs (
  id              uuid primary key default gen_random_uuid(),
  month           text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  line_name       text not null check (btrim(line_name) <> ''),
  shift           text check (shift in ('day', 'night')),          -- null = ทุกกะ (ยังไม่มีจอใช้ · เผื่อไว้)
  snapshot        jsonb not null,                                   -- amSignoffSnapshot() ณ ตอนลงนาม
  signed_by       uuid not null default auth.uid(),
  signed_by_name  text,
  position        text,                                             -- profiles.position (key) ณ ตอนลงนาม
  position_rank   int,                                              -- positionRank() ณ ตอนลงนาม · null = ไม่รู้
  signature_url   text,                                             -- สำเนา URL ลายเซ็นโปรไฟล์ ณ ตอนลงนาม
  signed_at       timestamptz not null default now(),
  note            text,
  status          text not null default 'signed' check (status in ('signed', 'revoked')),
  revoked_by      uuid,
  revoked_by_name text,
  revoked_at      timestamptz,
  revoke_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint am_monthly_signoffs_revoke_ck check (
    status = 'signed'
    or (revoked_at is not null and revoked_by is not null and length(btrim(coalesce(revoke_reason, ''))) >= 5)
  )
);

-- ลายเซ็นที่ยังมีผล: 1 แถวต่อ เดือน × ไลน์ × กะ (client insert ล้วน ไม่ upsert ⇒ partial/expression index ใช้ได้)
create unique index if not exists am_monthly_signoffs_active_uq
  on public.am_monthly_signoffs (month, line_name, coalesce(shift, ''))
  where status = 'signed';
create index if not exists am_monthly_signoffs_month_idx on public.am_monthly_signoffs (month, shift);

comment on table public.am_monthly_signoffs is
  'ลงนามทบทวน AM รายเดือน (ขั้น 3: หัวหน้าแผนก/ส่วน) ต่อ เดือน×ไลน์×กะ — snapshot = สรุปตอนลงนาม · '
  'ห้ามลบ เพิกถอน = status revoked + เหตุผล · คีย์ am:monthly_signoff · โค้ด src/lib/amMonthlySignoff.js';

-- 🔒 แถวที่ลงนามแล้ว: แก้ได้ทางเดียว = signed → revoked (+ผู้เพิกถอน/เหตุผล) · เนื้อลายเซ็นห้ามเปลี่ยน
create or replace function public.fn_am_monthly_signoff_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'revoked' then
    raise exception 'am_monthly_signoffs: ลายเซ็นที่เพิกถอนแล้วแก้ไม่ได้';
  end if;
  if new.month is distinct from old.month or new.line_name is distinct from old.line_name
     or new.shift is distinct from old.shift or new.snapshot is distinct from old.snapshot
     or new.signed_by is distinct from old.signed_by or new.signed_by_name is distinct from old.signed_by_name
     or new.position is distinct from old.position or new.position_rank is distinct from old.position_rank
     or new.signature_url is distinct from old.signature_url or new.signed_at is distinct from old.signed_at
     or new.note is distinct from old.note then
    raise exception 'am_monthly_signoffs: เนื้อลายเซ็นแก้ไม่ได้ — เพิกถอนแล้วลงนามใหม่';
  end if;
  if new.status = 'revoked' then
    new.revoked_by := auth.uid();     -- ผู้เพิกถอน = คนที่ login จริง ไม่ใช่ค่าที่ client ส่ง
    new.revoked_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_am_monthly_signoff_guard on public.am_monthly_signoffs;
create trigger trg_am_monthly_signoff_guard before update on public.am_monthly_signoffs
  for each row execute function public.fn_am_monthly_signoff_guard();

alter table public.am_monthly_signoffs enable row level security;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.am_monthly_signoffs;
    create trigger trg_set_updated_at before update on public.am_monthly_signoffs
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.am_monthly_signoffs;
    create trigger trg_audit after insert or update or delete on public.am_monthly_signoffs
      for each row execute function public.fn_audit();
  end if;
end $$;

-- อ่าน: ทุกบัญชีที่ login (หัวหน้ากลุ่ม/พนักงานต้องเห็นว่าเดือนไหนหัวหน้าแผนกทบทวนแล้ว)
drop policy if exists ams_read on public.am_monthly_signoffs;
create policy ams_read on public.am_monthly_signoffs for select to authenticated using (true);

-- ลงนาม: ต้องถือคีย์ + ลงในนามตัวเองเท่านั้น + ต้องเป็นแถวที่มีผล
drop policy if exists ams_insert on public.am_monthly_signoffs;
create policy ams_insert on public.am_monthly_signoffs for insert to authenticated
  with check ((select public.has_perm('am:monthly_signoff')) and signed_by = (select auth.uid()) and status = 'signed');

-- เพิกถอน: ต้องถือคีย์ · แถวเดิมต้องยังมีผล · แถวใหม่ต้องเป็น revoked (trigger กันแก้เนื้อ)
drop policy if exists ams_revoke on public.am_monthly_signoffs;
create policy ams_revoke on public.am_monthly_signoffs for update to authenticated
  using ((select public.has_perm('am:monthly_signoff')) and status = 'signed')
  with check ((select public.has_perm('am:monthly_signoff')) and status = 'revoked');

-- 🔴 GRANT ระดับตาราง (RLS ผ่านแต่ GRANT ขาด = PostgREST 401 · db-write-rules ข้อ 3.1) · ไม่ให้ delete ใคร
revoke all on public.am_monthly_signoffs from anon;
grant select, insert, update on public.am_monthly_signoffs to authenticated;

-- ── คีย์สิทธิ์ ───────────────────────────────────────────────────────────────────────────
insert into public.permission_catalog (resource, action, label, group_name, sort)
values ('am', 'monthly_signoff', 'AM: ลงนามทบทวนรายเดือน (หัวหน้าแผนก/ส่วนขึ้นไป)', 'การตรวจสอบและซ่อมบำรุง', 100)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'am:monthly_signoff', true
from (values ('admin'::user_role), ('manager'::user_role), ('supervisor'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions x where x.role = r.role and x.permission_key = 'am:monthly_signoff');

commit;

-- ── ตรวจผล ──
-- select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='am_monthly_signoffs' order by ordinal_position;
-- select policyname, cmd from pg_policies where tablename='am_monthly_signoffs';
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name='am_monthly_signoffs' order by 1,2;
-- select tgname from pg_trigger where tgrelid='public.am_monthly_signoffs'::regclass and not tgisinternal;
-- select role, allowed from role_permissions where permission_key='am:monthly_signoff' order by role;
