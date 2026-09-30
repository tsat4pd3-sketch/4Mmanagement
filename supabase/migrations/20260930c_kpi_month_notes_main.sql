-- ══ หมายเหตุรายเดือนบนแผ่น KPI (remark / action / note) — MAIN · ewhdfqwfwofivojtsizn · 2026-09-30 ══
-- user: "กราฟแท่งแต่ละเดือน แต่ละแท่งสามารถคลิกใส่ remark, action, noted เพื่อไว้กดเปิดดูเวลานำเสนอได้ว่าเกิดอะไรขึ้น"
-- คีย์ = (ปี, เดือน, ขอบเขตที่ดูบอร์ด, แผ่น) — `row_key` = ช่องบนบอร์ด (rm/dloh/inv/…) หรือ `def:<uuid>` ของแถว Key Performance
-- ⚠️ scope_value เก็บ '' แทน null สำหรับ "ทั้งโรงงาน" (client กรองด้วย .eq เสมอ · unique index ตรงไปตรงมา)
-- RLS: อ่าน = ทุกคนที่ login · เขียน = has_perm('kpi:manage') (คีย์เดียวกับปุ่มกรอก KPI) · ลบ = soft (is_active=false)
-- audit: fn_audit() ตัวปกติ (แก้ไขได้ ⇒ ต้องสืบได้ว่าใครเขียน/ลบ) · rollback: drop table public.kpi_month_notes;

create table if not exists public.kpi_month_notes (
  id              uuid primary key default gen_random_uuid(),
  year            int  not null,
  month           int  not null check (month between 1 and 12),
  scope_kind      text not null default 'plant',
  scope_value     text not null default '',
  row_key         text not null,
  kind            text not null default 'remark' check (kind in ('remark','action','note')),
  text            text not null,
  created_by      uuid default auth.uid(),
  created_by_name text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_kpi_month_notes_scope on public.kpi_month_notes (year, scope_kind, scope_value) where is_active;

alter table public.kpi_month_notes enable row level security;
do $$ begin
  create policy kpi_month_notes_read  on public.kpi_month_notes for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy kpi_month_notes_write on public.kpi_month_notes for all
    using (has_perm('kpi:manage')) with check (has_perm('kpi:manage'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_kpi_month_notes_updated on public.kpi_month_notes;
create trigger trg_kpi_month_notes_updated before update on public.kpi_month_notes
  for each row execute function public.fn_set_updated_at();

do $$ begin
  if exists (select 1 from pg_proc where proname='fn_audit') then
    drop trigger if exists trg_audit on public.kpi_month_notes;
    create trigger trg_audit after insert or update or delete on public.kpi_month_notes
      for each row execute function public.fn_audit();
  end if;
end $$;
-- ตรวจ: select count(*) from kpi_month_notes;
