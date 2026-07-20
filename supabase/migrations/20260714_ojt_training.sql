-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- Paperless ใบแจ้งการอบรมสอนงานโดยหัวหน้างาน (ON THE JOB TRAINING — ฟอร์ม FM-HRM-004)
-- บันทึกการอบรมในระบบ + พนักงานเซ็นชื่อบนจอ + export PDF layout ตามฟอร์มกระดาษ
-- หน้า /ojt-training (src/pages/OjtTraining.jsx)
-- ลายเซ็นพนักงาน: bucket `signatures` path <auth.uid ของคนบันทึก>/ojt_... (ตาม policy เดิม own-folder)

create table if not exists ojt_trainings (
  id           uuid primary key default gen_random_uuid(),
  train_date   date not null,
  time_from    text,
  time_to      text,
  location     text,
  dept         text default 'Production',   -- ฝ่าย
  section      text,                        -- ส่วน
  department   text,                        -- แผนก
  for_new           boolean not null default false,  -- ☑ สำหรับพนักงานใหม่/เปลี่ยนงาน
  for_review        boolean not null default false,  -- ☑ สำหรับการทบทวน/อบรมซ้ำ
  for_method_change boolean not null default false,  -- ☑ สำหรับการเปลี่ยนแปลงวิธีทำงาน
  topic        text,                        -- หัวข้อและรหัสเอกสารที่สอน (หลายบรรทัด)
  scope        text,                        -- ขอบเขตเนื้อหา (หลายบรรทัด)
  trainer_name text,                        -- ผู้สอนงาน
  duration_min integer,                     -- ระยะเวลา (นาที)
  maker_name    text, maker_sig_url    text,  -- ผู้จัดทำ
  approver_name text, approver_sig_url text,  -- ระดับจัดการอนุมัติ
  hr_name       text, hr_sig_url       text,  -- ช่องลายเซ็นที่ 3 (ผู้รับทราบ/HR)
  status       text not null default 'open' check (status in ('open','completed')),
  created_by   uuid,
  created_by_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists ojt_training_attendees (
  id            uuid primary key default gen_random_uuid(),
  training_id   uuid not null references ojt_trainings(id) on delete cascade,
  employee_id   uuid,               -- อ้าง employees.id (nullable — snapshot ชื่อ/รหัสไว้กัน master เปลี่ยน)
  emp_code      text,
  emp_name      text,
  pre_score     integer check (pre_score  is null or (pre_score  between 0 and 4)),
  post_score    integer check (post_score is null or (post_score between 0 and 4)),
  sign_url      text,               -- ลายเซ็นพนักงาน (วาดบนจอ → bucket signatures)
  eval_agree    boolean,            -- ผลประเมินความเข้าใจ: true=เห็นด้วย false=ไม่เห็นด้วย
  evaluator_name text,              -- ผู้ประเมิน (โดยหัวหน้าหรือผู้สอน)
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ojt_attendees_training on ojt_training_attendees(training_id);

alter table ojt_trainings          enable row level security;
alter table ojt_training_attendees enable row level security;
-- pattern เดียวกับตาราง Main อื่น: เปิด authenticated แล้วคุมสิทธิ์ที่ UI layer (role_permissions)
create policy "ojt_trainings_all" on ojt_trainings for all to authenticated using (true) with check (true);
create policy "ojt_attendees_all" on ojt_training_attendees for all to authenticated using (true) with check (true);

-- สิทธิ์: เข้าหน้าได้ทุก role (enum_range ณ ตอน seed — role ใหม่ภายหลังต้องติ๊กเองที่ /permissions)
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/ojt-training', true from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
-- บันทึก/แก้ไข = หัวหน้างานขึ้นไป · ลบ = ระดับจัดการ
insert into role_permissions (role, permission_key, allowed) values
  ('manager', 'ojt:record', true), ('supervisor', 'ojt:record', true), ('leader', 'ojt:record', true),
  ('manager', 'ojt:delete', true)
on conflict (role, permission_key) do nothing;
