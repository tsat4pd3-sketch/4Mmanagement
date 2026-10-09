-- ══ ลำดับแผ่น KPI บนบอร์ด OBEYA ต่อขอบเขต — MAIN · ewhdfqwfwofivojtsizn · 2026-10-09 ══
-- user (PD2 ผ่าน user): "อยาก config ตำแหน่งของ card KPI แต่ละตัวในแดชบอร์ดเอง"
-- 1 แถว = 1 (ปี, ขอบเขต) · `row_keys` = คีย์แผ่นเรียงตามที่คนจัด (ช่องมาตรฐาน rm/dloh/…/oee/ppm/safe/train หรือ `def:<uuid>`)
--   — คีย์เดียวกับ kpi_month_notes.row_key · แผ่นที่ไม่อยู่ในลิสต์ต่อท้ายตามลำดับ template (เพิ่ม KPI ใหม่ไม่หาย)
-- ⚠️ scope_value เก็บ '' แทน null สำหรับ "ทั้งโรงงาน" (ชุดเดียวกับ kpi_month_notes · unique ตรงไปตรงมา)
-- RLS: อ่าน = ทุกคนที่ login · เขียน = has_perm('kpi:manage') (คีย์เดียวกับปุ่มจัดการ KPI บนบอร์ด)
-- rollback: drop table public.kpi_board_layouts;  (จอกลับไปเรียงตาม template เหมือนเดิม — ไม่มีอะไรพัง)

create table if not exists public.kpi_board_layouts (
  id           uuid primary key default gen_random_uuid(),
  year         int  not null,
  scope_kind   text not null default 'plant',
  scope_value  text not null default '',
  row_keys     text[] not null default '{}',
  updated_by   uuid default auth.uid(),
  updated_by_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (year, scope_kind, scope_value)     -- 🔑 upsert key = unique index คอลัมน์ล้วน (กฎเขียน DB ข้อ 3)
);

alter table public.kpi_board_layouts enable row level security;
do $$ begin
  create policy kpi_board_layouts_read  on public.kpi_board_layouts for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy kpi_board_layouts_write on public.kpi_board_layouts for all
    using (has_perm('kpi:manage')) with check (has_perm('kpi:manage'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_kpi_board_layouts_updated on public.kpi_board_layouts;
create trigger trg_kpi_board_layouts_updated before update on public.kpi_board_layouts
  for each row execute function public.fn_set_updated_at();

do $$ begin
  if exists (select 1 from pg_proc where proname='fn_audit') then
    drop trigger if exists trg_audit on public.kpi_board_layouts;
    create trigger trg_audit after insert or update or delete on public.kpi_board_layouts
      for each row execute function public.fn_audit();
  end if;
end $$;
-- ตรวจ: select year, scope_kind, scope_value, row_keys from kpi_board_layouts;
