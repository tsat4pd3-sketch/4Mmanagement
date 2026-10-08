-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ทะเบียน "รูปแบบชุดแม่พิมพ์" (die_set_kinds) — 2026-10-05 · คำสั่ง user
--
-- ที่มา: รูปแบบชุด (die_sets.kind) เคย hardcode 4 ค่า (tandem/progressive/transfer/single) ทั้งในโค้ด
--   (DIE_SET_KINDS ใน equipmentKinds.js) และ check constraint `die_sets_kind_chk`
--   ทีมแม่พิมพ์ต้องการเพิ่ม HYDROFORM DIE / BEND DIE และ "ศัพท์ทางการ user หน้างานไม่เข้าใจ"
--   ⇒ ย้ายเป็นทะเบียนให้ทีมเพิ่ม/ตั้งชื่อเรียกเองได้ (pattern เดียวกับ die_press_lines / process_types)
--
-- โมเดล: die_sets.kind ยังเก็บ key (text) เหมือนเดิม **ไม่ผูก FK** (คอนเวนชันทะเบียน master ของระบบ —
--   ปิดใช้/ลบแถวแล้วชุดเก่ายังอ่านออก จอโชว์ key ดิบสีเทา ไม่หายเงียบ)
--   mo_item_type = ชื่อใน mtn_item_types ที่ใบแจ้งซ่อม (/mtn-repair) ใช้เติม "ชนิดอุปกรณ์" ให้เอง
--   เมื่อผู้แจ้งเลือกแม่พิมพ์ (ไม่ต้องให้ผู้แจ้งเลือกเอง — วัดจริง 05/10: ใบ DIE ที่ผู้แจ้งเลือกชนิดเอง
--   ไม่ตรงทะเบียน 2 ใน 4 ใบที่ระบุชนิด)
--
-- rollback (revert โค้ดก่อน แล้วค่อยแตะ schema):
--   alter table public.die_sets add constraint die_sets_kind_chk
--     check (kind in ('tandem','progressive','transfer','single'));   -- ต้องไม่มีชุดที่ใช้ key ใหม่ก่อน
--   drop table public.die_set_kinds;
--   delete from public.mtn_item_types where name in ('DIE HYDROFORM','DIE BEND') and updated_by_name = 'migration 20261005';

create table if not exists public.die_set_kinds (
  key              text primary key,            -- = ค่าที่เก็บใน die_sets.kind (ห้ามแก้หลังมีชุดใช้แล้ว)
  label            text not null,               -- ชื่อที่หน้างานเรียก (แก้ได้อิสระ)
  description      text,                        -- คำอธิบายภาษาบ้านๆ โชว์ใต้ช่องเลือก
  mo_item_type     text,                        -- ชื่อใน mtn_item_types ที่ใบแจ้งซ่อมเติมให้ (null = ให้ผู้แจ้งเลือกเอง)
  sort_order       integer not null default 100,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
comment on table public.die_set_kinds is
  'ทะเบียนรูปแบบชุดแม่พิมพ์ — die_sets.kind เก็บ key (text ไม่ผูก FK) · mo_item_type = ชนิดอุปกรณ์ที่ใบ MO เติมให้เมื่อเลือกแม่พิมพ์';

alter table public.die_set_kinds enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='die_set_kinds' and policyname='die_set_kinds_all') then
    create policy die_set_kinds_all on public.die_set_kinds for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;

drop trigger if exists trg_die_set_kinds_updated on public.die_set_kinds;
create trigger trg_die_set_kinds_updated before update on public.die_set_kinds for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_die_set_kinds_audit on public.die_set_kinds;
create trigger trg_die_set_kinds_audit after insert or update or delete on public.die_set_kinds for each row execute function public.fn_audit();

-- seed: 4 ค่าเดิม (ป้าย/คำอธิบายเดิมจากโค้ด) + 2 ชนิดที่ทีมแม่พิมพ์ขอ
insert into public.die_set_kinds (key, label, description, mo_item_type, sort_order) values
  ('tandem',      'Tandem (ชุดเรียง OP)',   'หลายแม่พิมพ์ เรียง OP คนละเครื่องปั๊ม',          'DIE TANDEM',      10),
  ('progressive', 'Progressive (ต่อเนื่อง)', 'บล็อกเดียว หลาย station ป้อนม้วนเหล็ก',         'DIE PROGRESSIVE', 20),
  ('transfer',    'Transfer',                'เครื่องเดียว หลาย station มีแขนย้ายชิ้น',         'DIE TRANSFER',    30),
  ('single',      'Single (OP เดียว)',       'จบในแม่พิมพ์ตัวเดียว',                            'DIE SINGLE',      40),
  ('hydroform',   'HYDROFORM DIE',           'แม่พิมพ์ขึ้นรูปด้วยแรงดันน้ำ (ไฮโดรฟอร์ม)',       'DIE HYDROFORM',   50),
  ('bend',        'BEND DIE',                'แม่พิมพ์ดัด/พับ',                                 'DIE BEND',        60)
on conflict (key) do nothing;

-- ค่าที่ชุดใช้อยู่แต่ไม่อยู่ใน seed (กันชุดเก่าหลุดเป็น key ดิบ) — ป้าย = key เดิม ให้ทีมตั้งชื่อเอง
insert into public.die_set_kinds (key, label, sort_order)
select distinct kind, kind, 900 from public.die_sets
where kind is not null and btrim(kind) <> ''
on conflict (key) do nothing;

-- ชนิดอุปกรณ์ในใบ MO ของ 2 ชนิดใหม่ (ทีม DIE MTN) — มีอยู่แล้ว = ไม่แตะ
insert into public.mtn_item_types (name, team, sort_order, is_active, updated_by_name)
select v.name, 'die_maintenance', v.so, true, 'migration 20261005'
from (values ('DIE HYDROFORM', 106), ('DIE BEND', 107)) as v(name, so)
where not exists (select 1 from public.mtn_item_types t where upper(btrim(t.name)) = upper(v.name));

-- ถอด check constraint — รายชื่อรูปแบบชุดอยู่ในทะเบียนแล้ว (ไม่งั้นชนิดที่ทีมเพิ่มเองบันทึกไม่ได้)
alter table public.die_sets drop constraint if exists die_sets_kind_chk;
