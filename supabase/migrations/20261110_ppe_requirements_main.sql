-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- 🦺 PPE: ทะเบียนรายการ + ข้อกำหนดรายหน่วย (4 ชั้น) + ผลตรวจรายคนรายวัน — 2026-11-10
--
-- ที่มา (คำสั่ง user): *"ยังขาดหน้าที่จะเอาไว้ setup ppe requirement ของแต่ละหน้างาน
--   บางไลน์ต้องมีผ้ากันเปื้อน ปลอกแขน แว่นตาอีก"*
--
-- ของเดิม: `daily_production_logs` มีแค่ 3 คอลัมน์ bool (หมวก/รองเท้า/ถุงมือ) ตายตัวทั้งโรงงาน
--   ⇒ ไลน์ที่ต้องใส่ผ้ากันเปื้อน/ปลอกแขน/แว่นตา บันทึกไม่ได้เลย
-- วัดจริง 12/10–10/11: มางาน 4,080 แถว · ติ๊ก PPE ครบ 99.6% (ไม่ครบแค่ 17 แถว)
--   ⇒ 3 ช่องเดิมเป็น "ตรายาง" แล้ว · ชั้นใหม่จึงต้องขึ้น**เฉพาะรายการที่หน่วยนั้นบังคับ** และเริ่มที่ "ยังไม่ติ๊ก"
--
-- 🔴 เข้ากันได้กับของเดิม: **ไม่ลบ ไม่แตะ 3 คอลัมน์เดิม** (จอ/รายงาน/`getRowStatus` ใช้อยู่)
--    รายการที่ตรงกับคอลัมน์เดิมผูกไว้ด้วย `ppe_items.legacy_col` ⇒ ติ๊กที่ชั้นใหม่ = ซิงก์คอลัมน์เดิมด้วย

-- ═══ 1) ทะเบียนรายการ PPE ═══════════════════════════════════════════════════
-- กู้จาก `archive.ppe_items_unused_20261014` (10 รายการ · ย้ายเข้ากรุ 14/10 ตอนยังไม่มีใครใช้)
-- + เพิ่ม "ปลอกแขน" ที่ user ระบุว่าหน้างานใช้จริงแต่ทะเบียนเดิมไม่มี
create table if not exists public.ppe_items (
  id          bigserial primary key,
  code        text not null unique,              -- safety_helmet · apron · arm_sleeve …
  name_th     text not null,
  icon        text,
  legacy_col  text check (legacy_col in ('has_helmet','has_boots','has_gloves')),
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);
create unique index if not exists ppe_items_legacy_col_uniq
  on public.ppe_items (legacy_col) where legacy_col is not null;

insert into public.ppe_items (code, name_th, icon, legacy_col, sort_order) values
  ('safety_helmet',  'หมวกนิรภัย',            'hard-hat',    'has_helmet',  10),
  ('safety_shoes',   'รองเท้านิรภัย',          'boot',        'has_boots',   20),
  ('safety_gloves',  'ถุงมือนิรภัย',           'hand',        'has_gloves',  30),
  ('safety_glasses', 'แว่นตานิรภัย',           'glasses',      null,         40),
  ('ear_protection', 'ที่ครอบหู/ที่อุดหู',      'ear',          null,         50),
  ('arm_sleeve',     'ปลอกแขน',               'arm',          null,         60),
  ('apron',          'ผ้ากันเปื้อน',            'apron',        null,         70),
  ('safety_vest',    'เสื้อกั๊กสะท้อนแสง',       'vest',         null,         80),
  ('face_shield',    'หน้ากากป้องกันใบหน้า',    'face-shield',  null,         90),
  ('welding_mask',   'หน้ากากเชื่อม',          'welding',      null,        100),
  ('respirator',     'หน้ากากกรองอากาศ',      'mask',         null,        110)
on conflict (code) do nothing;

-- ═══ 2) ข้อกำหนดรายหน่วย — 4 ชั้น ตกทอดจากบนลงล่าง ═══════════════════════════
-- plant (ทั้งโรงงาน) → section (ส่วนงาน) → line (ไลน์ · ไล่ตามสายแม่→ลูก) → station (จุดงาน)
-- ชั้นล่างชนะชั้นบนเสมอ · `required=false` = "ชั้นนี้ยกเว้น" (ปิดของที่ตกทอดมา ไม่ใช่แค่ไม่มีแถว)
--   ⇒ ต้องแยก "ไม่ได้ตั้ง" (ตกทอด) ออกจาก "ตั้งว่าไม่ต้อง" ให้ได้ ไม่งั้นยกเว้นรายไลน์ไม่ได้เลย
create table if not exists public.ppe_requirements (
  id          bigserial primary key,
  scope_kind  text not null check (scope_kind in ('plant','section','line','station')),
  scope_key   text not null,          -- plant='*' · section=ชื่อส่วนงาน · line=production_lines.id · station=workstations.id
  item_id     bigint not null references public.ppe_items(id) on delete cascade,
  required    boolean not null default true,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (scope_kind, scope_key, item_id)
);
create index if not exists ppe_requirements_scope_idx on public.ppe_requirements (scope_kind, scope_key);

-- 🔴 ค่าพื้นฐานทั้งโรงงาน = 3 ชิ้นเดิมที่ใช้กันอยู่แล้ว
--    ไม่ seed = วันแรกที่ deploy ทั้งโรงงานจะ "ไม่ต้องใส่อะไรเลย" = ถอยหลังจากของเดิมแบบเงียบๆ
insert into public.ppe_requirements (scope_kind, scope_key, item_id, required, note)
select 'plant', '*', id, true, 'ค่าพื้นฐานเดิมของทั้งโรงงาน (ตั้งอัตโนมัติตอนเปิดใช้ระบบ PPE)'
from public.ppe_items where legacy_col is not null
on conflict (scope_kind, scope_key, item_id) do nothing;

-- ═══ 3) ผลตรวจรายคนรายวัน ═══════════════════════════════════════════════════
-- แถวละ 1 รายการ (ไม่ใช่ jsonb) ⇒ ถามได้ว่า "เดือนนี้ขาดแว่นตากี่ครั้ง ไลน์ไหน"
create table if not exists public.ppe_check_items (
  id          bigserial primary key,
  work_date   date not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  item_id     bigint not null references public.ppe_items(id),
  ok          boolean not null,
  checked_by  uuid,
  checked_at  timestamptz not null default now(),
  unique (work_date, employee_id, item_id)
);
create index if not exists ppe_check_items_day_idx on public.ppe_check_items (work_date);

-- ═══ RLS + GRANT ═══════════════════════════════════════════════════════════
-- 🔴 GRANT ต้องครบทุก cmd ที่ client ใช้ด้วย — RLS ผ่านแต่ GRANT ขาด = PostgREST ตอบ 401
alter table public.ppe_items        enable row level security;
alter table public.ppe_requirements enable row level security;
alter table public.ppe_check_items  enable row level security;

grant select on public.ppe_items, public.ppe_requirements, public.ppe_check_items to authenticated;
grant insert, update, delete on public.ppe_items, public.ppe_requirements to authenticated;
grant insert, update on public.ppe_check_items to authenticated;
grant usage, select on sequence public.ppe_items_id_seq, public.ppe_requirements_id_seq,
      public.ppe_check_items_id_seq to authenticated;

-- อ่าน: ทุกคนที่ login (จอเช็คชื่อ/สแกนต้องรู้ว่าหน่วยนี้บังคับอะไร)
drop policy if exists ppe_items_read on public.ppe_items;
create policy ppe_items_read on public.ppe_items for select to authenticated using (true);
drop policy if exists ppe_req_read on public.ppe_requirements;
create policy ppe_req_read on public.ppe_requirements for select to authenticated using (true);
drop policy if exists ppe_check_read on public.ppe_check_items;
create policy ppe_check_read on public.ppe_check_items for select to authenticated using (true);

-- เขียนทะเบียน/ข้อกำหนด: คีย์เดียวกับปุ่มบนจอ `/ppe-setup`
drop policy if exists ppe_items_write on public.ppe_items;
create policy ppe_items_write on public.ppe_items for all to authenticated
  using (has_perm('ppe:manage')) with check (has_perm('ppe:manage'));
drop policy if exists ppe_req_write on public.ppe_requirements;
create policy ppe_req_write on public.ppe_requirements for all to authenticated
  using (has_perm('ppe:manage')) with check (has_perm('ppe:manage'));

-- เขียนผลตรวจ: คนเดียวกับที่เช็คชื่อได้ (คีย์เดียวกับ daily_production_logs)
drop policy if exists ppe_check_ins on public.ppe_check_items;
create policy ppe_check_ins on public.ppe_check_items for insert to authenticated
  with check (has_perm('checkin:record'));
drop policy if exists ppe_check_upd on public.ppe_check_items;
create policy ppe_check_upd on public.ppe_check_items for update to authenticated
  using (has_perm('checkin:record')) with check (has_perm('checkin:record'));

-- ═══ สิทธิ์ ═══════════════════════════════════════════════════════════════
-- ⚠️ seed แบบระบุ role ชัด ห้ามใช้ enum_range (role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้เงียบๆ)
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/ppe-setup', true
from unnest(array['admin','manager','supervisor']::user_role[]) r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'ppe:manage', true
from unnest(array['admin','manager']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- rollback (ย้อนโค้ดก่อน แล้วค่อยแตะ schema):
--   delete from role_permissions where permission_key in ('page:/ppe-setup','ppe:manage');
--   drop table if exists public.ppe_check_items;
--   drop table if exists public.ppe_requirements;
--   drop table if exists public.ppe_items;
