-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- Layer Process Audit (LPA) paperless — แทนฟอร์มกระดาษ 2 ใบ:
--   1) Layer Process Audit Plan   (แผนตรวจรายเดือน ต่อไลน์+กะ — สถานีตรวจรายวัน + ชั้นผู้ตรวจ ○●⊗)
--   2) Layer Process Audit Report (FM-QMR-008 Rev.01 — checklist Y/N/T/NA รายวัน + Weekly/Monthly/Quarterly)
-- หน้า /lpa (src/pages/LayerProcessAudit.jsx)
-- ชั้นผู้ตรวจ (layer): leader = ทุกวัน · supervisor(+engineer) = รายสัปดาห์ · manager = รายเดือน · gm = รายไตรมาส

-- คำถาม checklist (มาตรฐาน line_name = null ใช้ทุกไลน์ · special = ข้อเฝ้าระวังปัญหา ผูกไลน์+ช่วงวันที่)
create table if not exists lpa_questions (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('safety','quality','systemic','visual','special')),
  seq         integer not null default 0,
  question    text not null,
  line_name   text,             -- null = ทุกไลน์ · special มักระบุไลน์
  issue_start date,             -- ช่วงเฝ้าระวัง (เฉพาะ special) — แสดงเฉพาะวันที่อยู่ในช่วง
  issue_end   date,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- แผนตรวจรายเดือน (1 แผน ต่อ ไลน์+กะ+เดือน)
create table if not exists lpa_plans (
  id              uuid primary key default gen_random_uuid(),
  line_name       text not null,
  shift           text not null check (shift in ('day','night')),  -- 01 = day · 02 = night
  month_key       text not null,   -- 'YYYY-MM'
  leader_name     text, supervisor_name text, manager_name text, gm_name text,
  stations        text,            -- รายชื่อสถานีตรวจ (บรรทัด/คอมมาละชื่อ — ใช้เติมแผนอัตโนมัติ)
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (line_name, shift, month_key)
);

-- รายวันของแผน: สถานีที่ตรวจ + ชั้นที่วางแผนตรวจวันนั้น
create table if not exists lpa_plan_days (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references lpa_plans(id) on delete cascade,
  day             integer not null check (day between 1 and 31),
  station         text,
  plan_leader     boolean not null default false,
  plan_supervisor boolean not null default false,
  plan_manager    boolean not null default false,
  plan_gm         boolean not null default false,
  unique (plan_id, day)
);
create index if not exists idx_lpa_plan_days_plan on lpa_plan_days(plan_id);

-- ผลการตรวจ 1 ครั้ง (ไลน์+กะ+วัน+ชั้น) — คำตอบรายข้ออยู่ lpa_audit_answers
create table if not exists lpa_audits (
  id              uuid primary key default gen_random_uuid(),
  line_name       text not null,
  shift           text not null check (shift in ('day','night')),
  audit_date      date not null,
  layer           text not null check (layer in ('leader','supervisor','manager','gm')),
  station         text,
  auditor_name    text,
  auditor_sig_url text,
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (line_name, shift, audit_date, layer)
);
create index if not exists idx_lpa_audits_line_date on lpa_audits(line_name, audit_date);

create table if not exists lpa_audit_answers (
  id            uuid primary key default gen_random_uuid(),
  audit_id      uuid not null references lpa_audits(id) on delete cascade,
  question_id   uuid,
  question_text text,      -- snapshot กัน master เปลี่ยน/ลบ
  answer        text check (answer in ('Y','N','T','NA')),
  note          text,      -- บังคับกรอกเมื่อ N/T (ที่ UI)
  unique (audit_id, question_id)
);
create index if not exists idx_lpa_answers_audit on lpa_audit_answers(audit_id);

alter table lpa_questions      enable row level security;
alter table lpa_plans          enable row level security;
alter table lpa_plan_days      enable row level security;
alter table lpa_audits         enable row level security;
alter table lpa_audit_answers  enable row level security;
-- pattern ตาราง Main: เปิด authenticated แล้วคุมสิทธิ์ที่ UI layer (role_permissions)
create policy "lpa_questions_all" on lpa_questions     for all to authenticated using (true) with check (true);
create policy "lpa_plans_all"     on lpa_plans         for all to authenticated using (true) with check (true);
create policy "lpa_plan_days_all" on lpa_plan_days     for all to authenticated using (true) with check (true);
create policy "lpa_audits_all"    on lpa_audits        for all to authenticated using (true) with check (true);
create policy "lpa_answers_all"   on lpa_audit_answers for all to authenticated using (true) with check (true);

-- สิทธิ์: เข้าหน้าได้ทุก role (enum_range ณ ตอน seed — role ใหม่ภายหลังติ๊กเองที่ /permissions)
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/lpa', true from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
-- บันทึกผลตรวจ = ชั้นผู้ตรวจตามฟอร์ม (leader/sv/mgr + engineer/qa ร่วมตรวจ weekly ได้)
insert into role_permissions (role, permission_key, allowed) values
  ('manager', 'lpa:record', true), ('supervisor', 'lpa:record', true), ('leader', 'lpa:record', true),
  ('engineer', 'lpa:record', true), ('qa', 'lpa:record', true),
  ('manager', 'lpa:manage', true), ('supervisor', 'lpa:manage', true),   -- จัดการแผน + คำถาม master
  ('manager', 'lpa:delete', true)                                        -- ลบผลตรวจ
on conflict (role, permission_key) do nothing;

-- seed คำถามมาตรฐาน 23 ข้อ (ตามฟอร์ม FM-QMR-008 Rev.01) — line_name null = ทุกไลน์
insert into lpa_questions (category, seq, question) values
  ('safety', 1, 'สวมใส่อุปกรณ์เพื่อความปลอดภัยขณะทำงานหรือไม่'),
  ('safety', 2, 'มีการจัดเก็บอุปกรณ์เครื่องมือและเอกสารเป็นระเบียบหรือไม่'),
  ('safety', 3, 'มีการตรวจสอบความปลอดภัยอุปกรณ์หรือเครื่องจักรก่อนเริ่มงานหรือไม่'),
  ('safety', 4, 'ไม่มีการ BYPASS PUSH SWITCH'),
  ('safety', 5, 'ไม่มีสิ่งของวางขวางถังดับเพลิง'),
  ('quality', 6, 'มี SOP ติดที่ไลน์การผลิต และพนักงานเข้าใจขั้นตอนการทำงานและปฏิบัติตาม SOP ได้อย่างถูกต้อง'),
  ('quality', 7, 'มีงานตัวอย่างที่หน้าไลน์ (MASTER PART)'),
  ('quality', 8, 'มีการตรวจสอบระบบ JIG ด้วย DUMMY PART'),
  ('quality', 9, 'พนักงานตั้งค่า STEP COUNTER นับจำนวนชิ้นงานตามจำนวนที่กำหนดใน SOP'),
  ('quality', 10, 'พนักงานตรวจเช็คหัว CAP TIP / CONTACT TIP หลังทำความสะอาดเสร็จทุกครั้ง'),
  ('quality', 11, 'มีการบันทึกผล PPM, ERROR PROOFING, LINE CHECK SHEET, DAILY REPORT ถูกต้องและครบ'),
  ('quality', 12, 'มีการตรวจสอบคุณภาพชิ้นงานก่อนและหลังประกอบด้วยสายตา (VISUAL) และตรวจตามข้อกำหนด'),
  ('quality', 13, 'พนักงานมาร์ค NUT, BOLT, STUD ทุกตัวที่ประกอบหรือไม่'),
  ('quality', 14, 'มีการ CONFIRM ชิ้นงานแรกก่อนการผลิตร่วมกับ QA'),
  ('quality', 15, 'บรรจุภัณฑ์เป็นไปตาม PACKING STANDARD และอยู่ในสภาพพร้อมใช้งาน'),
  ('quality', 16, 'เมื่อพบชิ้นงาน NG สามารถทำตามขั้นตอนได้ถูกต้อง'),
  ('quality', 17, 'ชิ้นงานวางอยู่ในพื้นที่ ที่กำหนดไว้หรือไม่'),
  ('quality', 18, 'มีการอบรมให้กับพนักงานใหม่ (TRAINING / OJT)'),
  ('systemic', 19, 'พนักงานแต่งกายถูกต้องตามกฎระเบียบของบริษัท'),
  ('systemic', 20, 'พนักงานไม่ใช้โทรศัพท์ขณะปฏิบัติงาน'),
  ('systemic', 21, 'พนักงานไม่หยอกล้อหรือเล่นขณะปฏิบัติงาน'),
  ('visual', 22, 'พนักงานได้มีการตรวจสอบชิ้นงานด้วยสายตา (VISUAL) ก่อนการตรวจสอบบน INSPECTION JIG (C/F)'),
  ('visual', 23, 'มีการตรวจสอบไฟสัญญาณและอุปกรณ์บอกสถานะต่าง ๆ ของเครื่องจักร (ANDON)');
