-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ทะเบียนแม่พิมพ์: "แม่พิมพ์ 1 ตัว = 1 OP" · ชุด = รวม OP เป็นพาร์ท — 2026-11-05 · คำสั่ง user
--
-- ที่มา (user 05/11): "ทะเบียนแม่พิมพ์เละ" → คุยสรุปโมเดล
--   · รายละเอียดอยู่ที่แม่พิมพ์รายตัว (1 OP) — ชิ้น/shot ก็เป็นของ OP
--     เพราะ OP10 รับแผ่น 1 → draw · OP20 trim · OP30 separate ตัดแยก LH/RH = เข้า 1 ออก 2
--     ⇒ ช่องเดียว "ชิ้น/stroke" แยกไม่ออกว่า gang (เข้า 2) หรือ separate (ออก 2) = นับ shot ผิด
--   · progressive/blank ป้อนจากม้วน ⇒ ไม่มี "ชิ้นเข้า" มีแต่ระยะพิทช์ + ความกว้างคอยล์
--   · common die: ชุด 70/71BA ใช้ OP10/20/40 ของชุด 70/71AA เปลี่ยนแค่ OP30
--     ⇒ แม่พิมพ์ 1 ตัวต้องอยู่ได้หลายชุด
--   · หน้างานไม่มีเลขแม่พิมพ์ (ใช้ชื่อพาร์ท) ⇒ ระบบออกเลข D-xxxx (4 หลัก)
--
-- ทุกอย่าง additive — คอลัมน์ใหม่ nullable ไม่มี default (die_no ออกโดย trigger) ⇒ โค้ดเดิมไม่รู้จักก็ไม่พัง
-- 🔴 ไม่ backfill ค่าที่ต้องรู้จากหน้างาน (ชิ้นเข้า/ออก · ชนิดป้อน · พิทช์ · น้ำหนัก · เจ้าของ) — ว่าง = ยังไม่รู้
--
-- rollback (revert โค้ดก่อน แล้วค่อยแตะ schema):
--   drop table if exists public.die_set_shared_dies;
--   drop function if exists public.fn_die_set_shared_guard();
--   drop trigger if exists trg_equipment_die_die_no on public.equipment_die;
--   drop function if exists public.fn_equipment_die_assign_no();
--   alter table public.equipment_die
--     drop column if exists die_no, drop column if exists feed_type, drop column if exists pieces_in_per_stroke,
--     drop column if exists feed_pitch_mm, drop column if exists coil_width_mm,
--     drop column if exists weight_kg, drop column if exists length_mm, drop column if exists width_mm;
--   drop sequence if exists public.die_no_seq;
--   alter table public.die_sets drop column if exists owner;
--   (แถว equipment_die เปล่า 12 แถวที่สร้างให้ · updated_by_name='migration 20261105' ปล่อยไว้ได้ ไม่มีผลกับของเดิม)

-- ═══ 1) แม่พิมพ์รายตัว (1 OP) ═══════════════════════════════════════════════
alter table public.equipment_die
  add column if not exists die_no                text,     -- D-0001 · ระบบออกให้ ห้ามแก้มือ (ป้าย QR/คนอ้างถึง)
  add column if not exists feed_type             text,     -- 'sheet' แผ่น/ชิ้นจาก OP ก่อน · 'coil' ม้วน · null = ยังไม่ระบุ
  add column if not exists pieces_in_per_stroke  integer,  -- ชิ้นเข้า/shot (sheet) — คู่กับ pieces_per_stroke = ชิ้นออก/shot
  add column if not exists feed_pitch_mm         numeric,  -- ระยะพิทช์ (coil)
  add column if not exists coil_width_mm         numeric,  -- ความกว้างคอยล์ (coil)
  add column if not exists weight_kg             numeric,  -- น้ำหนักแม่พิมพ์
  add column if not exists length_mm             numeric,  -- ขนาด ยาว (ความสูง = die_height_mm ตอนปิดพิมพ์)
  add column if not exists width_mm              numeric;  -- ขนาด กว้าง

comment on column public.equipment_die.die_no is 'เลขแม่พิมพ์ D-xxxx — trigger ออกให้ตอน insert · unique · ห้ามแก้มือ';
comment on column public.equipment_die.feed_type is 'ชนิดป้อน: sheet (แผ่น/ชิ้นจาก OP ก่อน) · coil (ม้วน) · null = ยังไม่ระบุ';
comment on column public.equipment_die.pieces_in_per_stroke is 'ชิ้นเข้า/shot (feed_type=sheet) · null = ยังไม่รู้ ห้ามเดาเป็น 1';
comment on column public.equipment_die.pieces_per_stroke is 'ชิ้นออก/shot ของ OP นี้ (separate LH/RH = 2) · null = ยังไม่รู้ ห้ามเดาเป็น 1';
comment on column public.equipment_die.die_height_mm is 'ความสูงตอนปิดแม่พิมพ์ (มม.)';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_die_feed_type_chk') then
    alter table public.equipment_die add constraint equipment_die_feed_type_chk
      check (feed_type is null or feed_type in ('sheet','coil'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_die_positive_chk') then
    alter table public.equipment_die add constraint equipment_die_positive_chk check (
      (pieces_in_per_stroke is null or pieces_in_per_stroke > 0) and
      (feed_pitch_mm is null or feed_pitch_mm > 0) and (coil_width_mm is null or coil_width_mm > 0) and
      (weight_kg is null or weight_kg > 0) and (length_mm is null or length_mm > 0) and (width_mm is null or width_mm > 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_die_die_no_fmt_chk') then
    alter table public.equipment_die add constraint equipment_die_die_no_fmt_chk
      check (die_no is null or die_no ~ '^D-[0-9]{4,}$');
  end if;
end $$;
create unique index if not exists equipment_die_die_no_uq on public.equipment_die (die_no);
create sequence if not exists public.die_no_seq start 1;

-- ── backfill ──
-- (ก) แม่พิมพ์ที่ยังไม่มีแถวส่วนขยาย (12 ตัว ณ 05/11) — สร้างแถวเปล่าให้ เพื่อให้ได้เลข D-xxxx เหมือนตัวอื่น
--     ไม่เติมค่าอื่นใดทั้งสิ้น (ชุด/OP ให้ทีม DIE ไล่เอง · user 05/11)
insert into public.equipment_die (machine_id, updated_by_name)
select m.id, 'migration 20261105'
from public.machines m
where m.equipment_kind = 'die'
  and not exists (select 1 from public.equipment_die e where e.machine_id = m.id)
on conflict (machine_id) do nothing;

-- (ข) ออกเลขเรียง ไลน์ → ชุด → OP → ชื่อ (เลขติดกันในชุดเดียวกัน อ่านง่าย)
--     ใช้ลูปเพราะ `update … from (select … order by)` ไม่การันตีลำดับ nextval
--     แถวซ้ำที่ทีม DIE จะปิดทีหลังได้เลขไปด้วย = เลขเว้นช่วงได้ (เลขรันไม่จำเป็นต้องติดกัน)
do $$
declare r record;
begin
  for r in
    select e.machine_id
    from public.equipment_die e
    join public.machines m on m.id = e.machine_id
    left join public.die_sets s on s.id = e.die_set_id
    where e.die_no is null
    order by m.is_active desc, m.line_name nulls last, s.set_code nulls last, e.op_seq nulls last, m.machine_no
  loop
    update public.equipment_die
       set die_no = 'D-' || lpad(nextval('public.die_no_seq')::text, 4, '0'),
           -- fn_audit อ่าน actor จากแถว NEW — ไม่ stamp = audit ใส่ชื่อคนที่แก้ล่าสุดเป็นคนออกเลข (ผิด)
           updated_by_name = 'migration 20261105', updated_by_uid = null
     where machine_id = r.machine_id and die_no is null;
  end loop;
end $$;

-- (ค) แถวใหม่ทุกทาง (ฟอร์ม/MachineDatabase/DieLayout upsert) ได้เลขเอง
--     🔴 สร้าง "หลัง" backfill — ถ้าสร้างก่อน แถวเปล่าข้อ (ก) แย่งเลขแรกๆ ไปก่อนลูปเรียงลำดับ (เจอตอน dry-run)
create or replace function public.fn_equipment_die_assign_no() returns trigger
language plpgsql as $$
begin
  if new.die_no is null then
    new.die_no := 'D-' || lpad(nextval('public.die_no_seq')::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_equipment_die_die_no on public.equipment_die;
create trigger trg_equipment_die_die_no before insert on public.equipment_die
  for each row execute function public.fn_equipment_die_assign_no();

-- ═══ 2) ชุด: เจ้าของแม่พิมพ์ · ไลน์หลัก ═════════════════════════════════════════
alter table public.die_sets add column if not exists owner text;   -- 'company' · 'customer' · null = ยังไม่ระบุ
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'die_sets_owner_chk') then
    alter table public.die_sets add constraint die_sets_owner_chk check (owner is null or owner in ('company','customer'));
  end if;
end $$;
comment on column public.die_sets.owner is 'เจ้าของแม่พิมพ์: company / customer (customer-owned tooling ห้ามดัดแปลง/ทิ้งเอง) · null = ยังไม่ระบุ';
comment on column public.die_sets.line_name is 'ไลน์หลัก (กลุ่มเครื่องปั๊ม · ทะเบียน die_press_lines) — ตรงกับฝั่งผลิต';

-- ═══ 3) common die: ชุดที่ยืมแม่พิมพ์ของชุดอื่น ═══════════════════════════════════
-- บ้านของแม่พิมพ์ยังเป็น equipment_die.die_set_id (ชุดเดียว · ของเดิมทุกจออ่านตัวนี้ ไม่ต้องแก้)
-- ตารางนี้ = "ชุดอื่นที่ใช้แม่พิมพ์ตัวนี้ด้วย" + เป็น OP ที่เท่าไรของชุดนั้น
create table if not exists public.die_set_shared_dies (
  die_set_id      uuid not null references public.die_sets(id) on delete cascade,
  machine_id      uuid not null references public.machines(id) on delete cascade,
  op_seq          integer,          -- OP ในชุดที่ยืม (อาจไม่เท่ากับ OP ในชุดบ้าน)
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  updated_by_uid  uuid,
  primary key (die_set_id, machine_id)
);
comment on table public.die_set_shared_dies is
  'common die — ชุดที่ยืมแม่พิมพ์ของชุดอื่น (บ้าน = equipment_die.die_set_id) · ห้ามยืมเข้าชุดบ้านของตัวเอง';
create index if not exists die_set_shared_dies_machine_idx on public.die_set_shared_dies (machine_id);

-- ห้ามยืมเข้าชุดบ้านของตัวเอง (= OP ซ้ำในชุดเดียว)
create or replace function public.fn_die_set_shared_guard() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.equipment_die e
             where e.machine_id = new.machine_id and e.die_set_id = new.die_set_id) then
    raise exception 'แม่พิมพ์นี้อยู่ในชุดนี้อยู่แล้ว (เป็นชุดบ้าน) — ไม่ต้องเพิ่มเป็นตัวใช้ร่วม' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_die_set_shared_guard on public.die_set_shared_dies;
create trigger trg_die_set_shared_guard before insert or update on public.die_set_shared_dies
  for each row execute function public.fn_die_set_shared_guard();

alter table public.die_set_shared_dies enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='die_set_shared_dies' and policyname='die_set_shared_dies_all') then
    create policy die_set_shared_dies_all on public.die_set_shared_dies for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;
grant select, insert, update, delete on public.die_set_shared_dies to anon, authenticated;

drop trigger if exists trg_die_set_shared_dies_updated on public.die_set_shared_dies;
create trigger trg_die_set_shared_dies_updated before update on public.die_set_shared_dies
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_die_set_shared_dies_audit on public.die_set_shared_dies;
create trigger trg_die_set_shared_dies_audit after insert or update or delete on public.die_set_shared_dies
  for each row execute function public.fn_audit();
