-- ═══ 🤝 ยืมพนักงานข้ามไลน์รายกะ (line_helpers) — feedback หน้างาน 2026-08-19 ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- ที่มา: หัวหน้ากลุ่มดึงพนักงานไลน์อื่นมาช่วยชั่วคราวไม่ได้ — scope ของ leader กรอง
--   employees ด้วย family ไลน์ตัวเอง คนไลน์อื่น "มองไม่เห็น" ทั้งหน้าเช็คชื่อและผังจัดกำลังคน
-- โมเดล: 1 แถว = ยืมพนักงาน 1 คน มาช่วยไลน์ปลายทาง 1 กะ (วัน+กะ+คน unique —
--   คนหนึ่งถูกยืมได้ทีละไลน์ต่อกะ ไลน์ที่สองต้องให้ไลน์แรกกดคืนก่อน)
-- ไม่แตะ employees.line_id (ตัวตนถาวรอยู่ไลน์เดิม — การยืมเป็นเรื่องรายวัน)
--
-- Rollback: drop table public.line_helpers;

create table if not exists public.line_helpers (
  id              uuid primary key default gen_random_uuid(),
  work_date       date not null,
  shift           text not null default 'day' check (shift in ('day', 'night')),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  to_line_id      integer not null references public.production_lines(id) on delete cascade,
  note            text,
  created_by_name text,
  created_at      timestamptz not null default now(),
  unique (work_date, shift, employee_id)
);

create index if not exists idx_line_helpers_date on public.line_helpers (work_date, shift);

alter table public.line_helpers enable row level security;

-- pattern เดียวกับตารางปฏิบัติการรายวันอื่นฝั่ง Main (เช่น pokayoke_checks):
-- authenticated ทำได้ทั้งหมด — สิทธิ์ปุ่มคุมที่ UI ผ่าน can('checkin','record')
drop policy if exists line_helpers_all on public.line_helpers;
create policy line_helpers_all on public.line_helpers
  for all to authenticated using (true) with check (true);
