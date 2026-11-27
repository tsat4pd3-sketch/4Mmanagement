-- 🛠️ TPM เฟส 1 — ① ระดับความสำคัญเครื่อง (A/B/C) ② F-Tag ใบแท็กความผิดปกติ ⑤ ปิดวงจรซ่อม (Why-Why ใน MO)
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-27 · คำสั่ง user "เริ่มข้อ 1+2+5"
-- 📄 docs/modules/tpm.md · สูตร/สถานะทั้งหมดตัดสินใน src/utils/tpm.js (ฐานเก็บแค่ "ข้อเท็จจริง")
--
-- ตัดสินใจกับ user 27/11:
--   · เกรดเครื่อง = ให้คะแนนรายหัวข้อ แล้ว "ระบบคิด" — ฐานเก็บคะแนนดิบเท่านั้น **ไม่เก็บเกรด**
--     (เปลี่ยนเกณฑ์แล้วเกรดตามเองทุกเครื่อง · ไม่มีเกรดค้างของเกณฑ์เก่า)
--   · F-Tag แยกจาก MO · แท็กแดงกด "เปิด MO" แล้วผูก `mo_id` · สถานะ "ปิดแล้ว" ของแท็กแดงอ่านจาก MO
--     (ไม่มี trigger บน mtn_orders — ไม่ขยาย blast radius ของใบซ่อม)
--   · Why-Why บังคับเฉพาะเครื่องเกรด A — ด่านอยู่ฝั่งจอ (DR anon · กฎเหล็ก supabaseDR) ช่องใหม่ nullable ทั้งหมด
--
-- 🔴 DR = anon เสมอ ⇒ RLS เปิด anon (แบบเดียวกับ machines/mtn_orders) · สิทธิ์จริงอยู่ที่ can() ฝั่งจอ (known gap เดิม)
-- 🔴 ไม่มี DELETE ให้ client — แท็กผิด = "ยกเลิก" พร้อมเหตุผล · เกณฑ์เลิกใช้ = is_active=false
-- additive ล้วน · ย้อน: ท้ายไฟล์

-- ── ① เกณฑ์ให้คะแนนความสำคัญ (ทะเบียน แก้ได้ที่ /tpm?tab=crit) ─────────────────────────
create table if not exists public.tpm_crit_factors (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  label           text not null,
  guide_1         text,              -- ความหมายของคะแนน 1 / 2 / 3 (ให้คนประเมินเลือกตรงกัน)
  guide_2         text,
  guide_3         text,
  weight          int  not null default 1 check (weight between 1 and 5),
  force_a         boolean not null default false,   -- ได้ 3 ข้อนี้ = เกรด A ทันที (เช่น ความปลอดภัย)
  sort_order      int  not null default 0,
  is_active       boolean not null default true,
  updated_by_name text,
  updated_by_uid  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- เกณฑ์ตัดเกรด (% ของคะแนนเต็ม) — key/value เพื่อเพิ่มค่าตั้งของ TPM ได้โดยไม่ต้องเพิ่มคอลัมน์
create table if not exists public.tpm_settings (
  id              uuid primary key default gen_random_uuid(),   -- fn_audit ใช้ id เป็น row_pk
  key             text not null unique,
  value           numeric not null,
  label           text,
  updated_by_name text,
  updated_by_uid  uuid,
  updated_at      timestamptz not null default now()
);

-- คะแนนของแต่ละเครื่อง — 1 แถวต่อเครื่อง · ผูกด้วย machines.id (ไม่ใช่ machine_no ที่เป็น text)
create table if not exists public.machine_criticality (
  id               uuid primary key default gen_random_uuid(),   -- fn_audit ใช้ id เป็น row_pk
  machine_id       uuid not null unique references public.machines(id) on delete cascade,
  scores           jsonb not null default '{}'::jsonb,   -- { <factor key>: 1|2|3 }
  note             text,
  assessed_at      timestamptz,
  assessed_by_name text,
  assessed_by_uid  uuid,
  updated_by_name  text,
  updated_by_uid   uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── ② F-Tag ────────────────────────────────────────────────────────────────────────
create table if not exists public.tpm_ftag_types (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  label           text not null,
  sort_order      int  not null default 0,
  is_active       boolean not null default true,
  updated_by_name text,
  updated_by_uid  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.tpm_ftags (
  id                   uuid primary key default gen_random_uuid(),
  tag_no               text unique,                           -- ออกโดย trigger (FT-YYMM-0001) ห้ามส่งจาก client
  color                text not null check (color in ('red','white')),   -- แดง = ต้องใช้ช่าง · ขาว = ผู้ปฏิบัติงานแก้เอง
  machine_id           uuid references public.machines(id) on delete set null,
  machine_no           text,                                  -- สำเนาตอนติดแท็ก (ทะเบียนเครื่องเปลี่ยน/ลบ ก็ยังรู้ว่าติดที่ไหน)
  line_name            text,
  type_key             text,                                  -- tpm_ftag_types.key (text ไม่ผูก FK แบบทะเบียน master อื่น)
  detail               text not null check (length(btrim(detail)) > 0),
  found_at             timestamptz not null default now(),
  work_date            date,
  found_by_name        text,
  found_by_uid         uuid,
  status               text not null default 'open' check (status in ('open','mo','closed','cancelled')),
  mo_id                uuid unique references public.mtn_orders(id) on delete set null,
  source_inspection_id uuid,                                  -- ติดจากผลตรวจ AM/PM ที่ไม่ผ่าน (ถ้ามี)
  closed_at            timestamptz,
  closed_by_name       text,
  closed_by_uid        uuid,
  close_note           text,
  cancel_reason        text,
  updated_by_name      text,
  updated_by_uid       uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- ปิด/ยกเลิก ต้องมีเหตุผล · แปลงเป็น MO ต้องมีใบ — กันแถวสถานะลอย (ด่านฝั่งจออยู่ utils/tpm.js อีกชั้น)
  constraint tpm_ftags_close_note check (status <> 'closed' or length(btrim(coalesce(close_note,''))) > 0),
  constraint tpm_ftags_cancel_reason check (status <> 'cancelled' or length(btrim(coalesce(cancel_reason,''))) > 0),
  constraint tpm_ftags_mo_needs_id check (status <> 'mo' or mo_id is not null),
  constraint tpm_ftags_mo_red_only check (status <> 'mo' or color = 'red')
);
create index if not exists tpm_ftags_status_idx  on public.tpm_ftags (status, found_at desc);
create index if not exists tpm_ftags_machine_idx on public.tpm_ftags (machine_id);
create index if not exists tpm_ftags_line_idx    on public.tpm_ftags (line_name);

-- เลขแท็ก = สูงสุดของเดือน (เวลาไทย) + 1 · ล็อกรายเดือนกันเลขชน (กฎ "ห้าม count()+1")
create or replace function public.fn_tpm_ftag_no() returns trigger
language plpgsql as $$
declare ym text; n int;
begin
  ym := to_char(coalesce(new.found_at, now()) at time zone 'Asia/Bangkok', 'YYMM');
  perform pg_advisory_xact_lock(hashtext('tpm_ftag_no:' || ym));
  select coalesce(max(split_part(tag_no, '-', 3)::int), 0) + 1 into n
    from public.tpm_ftags where tag_no like 'FT-' || ym || '-%';
  new.tag_no := 'FT-' || ym || '-' || lpad(n::text, 4, '0');
  return new;
end $$;
drop trigger if exists trg_tpm_ftag_no on public.tpm_ftags;
create trigger trg_tpm_ftag_no before insert on public.tpm_ftags
  for each row execute function public.fn_tpm_ftag_no();

-- updated_at ทุกตาราง
create or replace function public.fn_tpm_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['tpm_crit_factors','tpm_settings','machine_criticality','tpm_ftag_types','tpm_ftags'] loop
    execute format('drop trigger if exists trg_%1$s_touch on public.%1$s', t);
    execute format('create trigger trg_%1$s_touch before update on public.%1$s for each row execute function public.fn_tpm_touch()', t);
  end loop;
end $$;

-- ── ⑤ ปิดวงจรซ่อม — ช่องใหม่ใน MO (nullable ทั้งหมด · ใบเก่าไม่กระทบ) ─────────────────
alter table public.mtn_orders add column if not exists failure_mode   text;    -- อาการเสียในเชิงกลไก (สึก/หลวม/ร้อน/รั่ว…)
alter table public.mtn_orders add column if not exists why_why        jsonb;   -- ["ทำไม 1", "ทำไม 2", …] เรียงจากอาการ → ต้นเหตุ
alter table public.mtn_orders add column if not exists prevent_action text;    -- 'pm_plan' | 'opl' | 'design' | 'none'
alter table public.mtn_orders add column if not exists prevent_note   text;    -- ทำอะไร/ทำไมไม่ทำ (บังคับเมื่อ none)

-- ── RLS + GRANT (anon เหมือนตาราง DR อื่น · ไม่ให้ DELETE) ──────────────────────────────
-- เขียนตรงรายตาราง (ด่าน new-table-needs-rls อ่านไฟล์เป็นข้อความ มองไม่เห็นในลูป format) · ซ้ำกับลูปข้างล่างได้ (idempotent)
alter table public.tpm_crit_factors    enable row level security;
alter table public.tpm_settings        enable row level security;
alter table public.machine_criticality enable row level security;
alter table public.tpm_ftag_types      enable row level security;
alter table public.tpm_ftags           enable row level security;
do $$ declare t text; begin
  foreach t in array array['tpm_crit_factors','tpm_settings','machine_criticality','tpm_ftag_types','tpm_ftags'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select to anon, authenticated using (true)', t);
    execute format('create policy %1$s_ins on public.%1$s for insert to anon, authenticated with check (true)', t);
    execute format('create policy %1$s_upd on public.%1$s for update to anon, authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%1$s from anon, authenticated', t);
    execute format('grant select, insert, update on public.%1$s to anon, authenticated', t);
  end loop;
end $$;

-- ── audit (ใคร/เมื่อไหร่/ค่าเก่า) — fn_audit อ่าน updated_by_name เป็น actor (ตารางอยู่ใน DR_AUDIT_TABLES) ──
do $$ declare t text; begin
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    foreach t in array array['tpm_crit_factors','tpm_settings','machine_criticality','tpm_ftag_types','tpm_ftags'] loop
      execute format('drop trigger if exists trg_audit on public.%1$s', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%1$s for each row execute function public.fn_audit()', t);
    end loop;
  end if;
end $$;

-- ── seed (แก้ได้ที่จอ · ค่าเริ่มต้นตามแนว JIPM) ─────────────────────────────────────────
insert into public.tpm_crit_factors (key, label, guide_1, guide_2, guide_3, weight, force_a, sort_order) values
  ('safety',   'ความปลอดภัย / สิ่งแวดล้อม', 'เสียแล้วไม่มีผลต่อคน/สิ่งแวดล้อม', 'อาจทำให้บาดเจ็บเล็กน้อย/รั่วไหลเล็กน้อย', 'อาจทำให้บาดเจ็บรุนแรง/ผิดกฎหมาย', 1, true, 10),
  ('quality',  'คุณภาพ',                   'ไม่กระทบคุณภาพชิ้นงาน', 'เสียแล้วเกิดของเสียได้ ตรวจจับได้ในไลน์', 'เสียแล้วของเสียหลุดถึงลูกค้าได้ / จุดสำคัญ (SC/CC)', 1, false, 20),
  ('delivery', 'การส่งมอบ (คอขวด/สำรอง)',   'มีเครื่องสำรอง หรือไม่ใช่คอขวด', 'สำรองได้บางส่วน / ทำล่วงหน้าได้', 'ไม่มีสำรอง เป็นคอขวด ไลน์หยุดทั้งไลน์', 1, false, 30),
  ('cost',     'ค่าซ่อม / เวลาซ่อม',         'ซ่อมเสร็จ < 1 ชม. ค่าใช้จ่ายต่ำ', 'ซ่อม 1–8 ชม. หรือรออะไหล่ไม่นาน', 'ซ่อม > 8 ชม. / อะไหล่นำเข้า ราคาสูง', 1, false, 40),
  ('frequency','ความถี่การเสีย',            'แทบไม่เสีย (< 1 ครั้ง/ไตรมาส)', 'เสียบ้าง (1–3 ครั้ง/ไตรมาส)', 'เสียบ่อย (> 1 ครั้ง/เดือน)', 1, false, 50)
on conflict (key) do nothing;

insert into public.tpm_settings (key, value, label) values
  ('crit_a_min_pct', 70, 'เกรด A เมื่อคะแนนถ่วงน้ำหนัก ≥ % ของคะแนนเต็ม'),
  ('crit_b_min_pct', 45, 'เกรด B เมื่อคะแนนถ่วงน้ำหนัก ≥ % ของคะแนนเต็ม (ต่ำกว่านี้ = C)')
on conflict (key) do nothing;

-- ประเภทความผิดปกติ 7 ข้อของ JIPM (ใช้ในขั้น AM 1)
insert into public.tpm_ftag_types (key, label, sort_order) values
  ('minor_flaw',     'ความบกพร่องเล็กน้อย (สกปรก/หลวม/สึก/สั่น/ผิดรูป)', 10),
  ('basic_cond',     'สภาพพื้นฐานไม่ครบ (หล่อลื่น/ขันแน่น/ป้ายบอก)',    20),
  ('hard_access',    'จุดที่เข้าถึงยาก (ทำความสะอาด/ตรวจ/หล่อลื่นยาก)', 30),
  ('contam_source',  'แหล่งที่มาของสิ่งสกปรก (รั่ว/กระเด็น/ฝุ่น)',       40),
  ('quality_source', 'แหล่งที่มาของปัญหาคุณภาพ',                         50),
  ('unneeded',       'สิ่งของที่ไม่จำเป็น',                              60),
  ('unsafe',         'จุดที่ไม่ปลอดภัย',                                 70)
on conflict (key) do nothing;

comment on table public.tpm_ftags is 'TPM F-Tag ใบแท็กความผิดปกติ (แดง=ช่าง · ขาว=ผู้ปฏิบัติงาน) · สถานะตัดสินที่ src/utils/tpm.js ftagState()';
comment on table public.machine_criticality is 'TPM คะแนนความสำคัญเครื่อง (ดิบ) · เกรด A/B/C คิดสดที่ src/utils/tpm.js critGrade() ไม่เก็บในฐาน';

-- ตรวจ:
--   select key, label, force_a from tpm_crit_factors order by sort_order;              -- 5 แถว
--   select * from tpm_settings;                                                          -- 2 แถว
--   select count(*) from tpm_ftag_types;                                                 -- 7
--   select has_table_privilege('anon','public.tpm_ftags','delete');                      -- false
--   select column_name from information_schema.columns where table_name='mtn_orders'
--     and column_name in ('failure_mode','why_why','prevent_action','prevent_note');     -- 4 แถว
--
-- ย้อน (โค้ดต้อง revert ก่อน · ข้อมูลแท็ก/คะแนนจะหาย — ย้ายเข้า archive ก่อนถ้ามีข้อมูลจริง):
--   create schema if not exists archive;
--   alter table public.tpm_ftags set schema archive;  (ทำซ้ำกับ machine_criticality / tpm_crit_factors / tpm_settings / tpm_ftag_types)
--   drop function if exists public.fn_tpm_ftag_no(); drop function if exists public.fn_tpm_touch();
--   alter table public.mtn_orders drop column if exists failure_mode, drop column if exists why_why,
--     drop column if exists prevent_action, drop column if exists prevent_note;
