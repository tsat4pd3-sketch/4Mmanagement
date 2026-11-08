-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ทะเบียนเล็ก 2 ตัวจาก audit dropdown 05/11 (คำสั่ง user "ทำข้อ TrialBookingModal กับ PKG_CATEGORIES ต่อเลย")
--
-- ① trial_reasons — เหตุผลจองเครื่องทดลอง (เดิม hardcode 6 ตัวใน components/TrialBookingModal.jsx)
--    ปลายทาง production_plan_lots.trial_reason เก็บ **label เป็น text** เหมือนเดิม (ไม่ผูก FK) · "อื่นๆ (พิมพ์เอง)" ยังมีในจอ
--    จัดการที่ /production-plan แท็บ ⚙️ ตั้งค่า (user เลือก 05/11)
-- ② container_categories — ประเภทภาชนะ (เดิม hardcode PKG_CATEGORIES ใน pages/ProductMaster.jsx + ช่องพิมพ์เอง)
--    ปลายทาง container_types.category เก็บ **code** · ช่องเป็น select จากทะเบียน (user เลือก "บังคับเลือก")
--    จัดการในหน้าต่าง "จัดการภาชนะ" ของ /products แท็บ Packaging
--    ข้อมูลตอนสร้าง: container_types 5 แถว — RACK 1 · ว่าง 4 ⇒ seed ครอบค่าที่มีอยู่แล้ว ไม่ต้องแก้ข้อมูล
--
-- ย้อนกลับ: drop table public.trial_reasons; drop table public.container_categories;  (ไม่มีตารางไหนผูก FK · ไม่ได้แก้ข้อมูลเดิม)

-- ═══ ① trial_reasons ═══
create table if not exists public.trial_reasons (
  code            text primary key,
  label           text not null,
  note            text,
  sort_order      integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table public.trial_reasons is
  'ทะเบียนเหตุผลจองเครื่องทดลอง — production_plan_lots.trial_reason เก็บ label (text ไม่ผูก FK) · จัดการที่ /production-plan แท็บ ⚙️ ตั้งค่า';
alter table public.trial_reasons enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trial_reasons' and policyname='trial_reasons_all') then
    create policy trial_reasons_all on public.trial_reasons for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;
grant select, insert, update, delete on public.trial_reasons to anon, authenticated;
drop trigger if exists trg_trial_reasons_updated on public.trial_reasons;
create trigger trg_trial_reasons_updated before update on public.trial_reasons for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_trial_reasons_audit on public.trial_reasons;
create trigger trg_trial_reasons_audit after insert or update or delete on public.trial_reasons for each row execute function public.fn_audit();

-- seed = 6 ตัวเดิมในโค้ด (ลำดับเดิม) · code = label ตัวพิมพ์ใหญ่ (แบบเดียวกับ customers)
insert into public.trial_reasons (code, label, sort_order) values
  ('T0 TRYOUT',             'T0 tryout',             10),
  ('T1 TRYOUT / แก้ไข',      'T1 tryout / แก้ไข',      20),
  ('RUN@RATE',              'Run@Rate',              30),
  ('ECI / เปลี่ยนแบบ',        'ECI / เปลี่ยนแบบ',        40),
  ('4M CHANGE',             '4M change',             50),
  ('ทดลองวัสดุใหม่',           'ทดลองวัสดุใหม่',           60)
on conflict (code) do nothing;

-- ═══ ② container_categories ═══
create table if not exists public.container_categories (
  code            text primary key,
  name            text not null,
  note            text,
  sort_order      integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'container_categories_code_upper') then
    alter table public.container_categories add constraint container_categories_code_upper check (code = upper(btrim(code)) and code <> '');
  end if;
end $$;
comment on table public.container_categories is
  'ทะเบียนประเภทภาชนะ — container_types.category เก็บ code (text ไม่ผูก FK) · จัดการที่ /products แท็บ Packaging → จัดการภาชนะ';
alter table public.container_categories enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='container_categories' and policyname='container_categories_all') then
    create policy container_categories_all on public.container_categories for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;
grant select, insert, update, delete on public.container_categories to anon, authenticated;
drop trigger if exists trg_container_categories_updated on public.container_categories;
create trigger trg_container_categories_updated before update on public.container_categories for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_container_categories_audit on public.container_categories;
create trigger trg_container_categories_audit after insert or update or delete on public.container_categories for each row execute function public.fn_audit();

-- seed = 5 ตัวเดิมในโค้ด ('Other' → code OTHER · ไม่มีแถวไหนใช้ 'Other' อยู่ — ตรวจแล้ว 05/11)
insert into public.container_categories (code, name, sort_order) values
  ('BOX',      'กล่อง',     10),
  ('RACK',     'แร็ค',      20),
  ('BASKET',   'ตะกร้า',    30),
  ('PALLETTE', 'พาเลท',     40),
  ('OTHER',    'อื่นๆ',      90)
on conflict (code) do nothing;
