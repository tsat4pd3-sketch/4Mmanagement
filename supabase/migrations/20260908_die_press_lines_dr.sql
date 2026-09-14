-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ทะเบียนกลุ่มเครื่องปั๊ม/ไลน์ของแม่พิมพ์ (die_press_lines) — 2026-09-08 · คำสั่ง user "ลุยเลย" หลัง audit 2026-09-07
--
-- ที่มา: die_sets.line_name / machines.line_name (equipment_kind='die') ใช้ค่าอย่าง "LINE A ( 800 Ton )" ที่ไม่มีใน
-- production_lines → DieRegistry ต้อง derive รายชื่อจากแถวของตัวเอง · MtnRepair ลิสต์แม่พิมพ์ทั้งหมดไม่กรอง
-- ตั้งใจ **ไม่** เพิ่มเป็นแถวใน production_lines (จะโผล่ใน dropdown ไลน์ผลิต/scope/OEE/TV ทุกหน้า) — แยกทะเบียนแทน
-- โมเดล: die_sets.line_name / machines.line_name ยังเก็บ name (text) เหมือนเดิม · ref_production_line = ชื่อไลน์ผลิตจริง
-- เมื่อกลุ่มนั้นคือไลน์ผลิต (HDF1/HDF2) เพื่อให้ linkage ไป production_sessions/OEE ได้ในอนาคต

create table if not exists public.die_press_lines (
  code                 text primary key,
  name                 text not null unique,     -- = ค่าที่เก็บใน die_sets.line_name / machines.line_name
  tonnage              text,                     -- ป้ายบอกขนาด เช่น '800 Ton' / '110&300 Ton'
  ref_production_line  text,                     -- ชื่อใน production_lines (Main) เมื่อกลุ่มนี้คือไลน์ผลิตจริง
  note                 text,
  sort_order           integer not null default 100,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by_name      text
);
comment on table public.die_press_lines is
  'ทะเบียนกลุ่มเครื่องปั๊ม/ไลน์ของแม่พิมพ์ — คนละชุดกับ production_lines (ตั้งใจไม่ปนกัน) · die_sets/machines เก็บ name (text)';

alter table public.die_press_lines enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='die_press_lines' and policyname='die_press_lines_all') then
    create policy die_press_lines_all on public.die_press_lines for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;

drop trigger if exists trg_die_press_lines_updated on public.die_press_lines;
create trigger trg_die_press_lines_updated before update on public.die_press_lines for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_die_press_lines_audit on public.die_press_lines;
create trigger trg_die_press_lines_audit after insert or update or delete on public.die_press_lines for each row execute function public.fn_audit();

-- ═══ seed จากค่าที่มีอยู่จริง (die_sets ∪ machines แม่พิมพ์) — tonnage ถอดจากวงเล็บ · HDF1/HDF2 = ไลน์ผลิตจริง ═══
with src as (
  select line_name as name from public.die_sets where line_name is not null and btrim(line_name) <> ''
  union
  select line_name from public.machines where equipment_kind = 'die' and line_name is not null and btrim(line_name) <> ''
), norm as (
  select distinct btrim(name) as name from src
)
insert into public.die_press_lines (code, name, tonnage, ref_production_line, sort_order)
select upper(regexp_replace(regexp_replace(name, '\s*\(.*\)\s*$', ''), '[^A-Za-z0-9]+', '_', 'g')),
       name,
       nullif(btrim(substring(name from '\(([^)]*)\)')), ''),
       case when name ~ '^HDF[0-9]+$' then name end,
       row_number() over (order by name) * 10
from norm
on conflict (code) do nothing;
