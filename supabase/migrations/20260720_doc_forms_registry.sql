-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- ทะเบียนเอกสาร & ฟอร์ม (Document Master) — หน้า /doc-forms
-- เก็บ เลขฟอร์ม/Rev/Effective Date/ช่องลายเซ็น/footer ของฟอร์มพิมพ์ทุกตัวในระบบ
-- ให้ document_control แก้ได้เองไม่ต้องแก้โค้ด · โค้ดอ้างด้วย doc_key (คงที่) + fallback ค่าเดิมในโค้ดเสมอ
-- util: src/utils/docForms.js (getDocForm)

create table if not exists doc_forms (
  id             uuid primary key default gen_random_uuid(),
  doc_key        text not null unique,   -- คีย์ที่โค้ดใช้อ้าง — ห้ามแก้ (ojt, lpa_report, ...)
  form_code      text,                   -- เลขฟอร์ม เช่น FM-HRM-004
  title          text,
  rev            text,                   -- เช่น Rev.01
  effective_date text,                   -- เก็บ text ตามที่พิมพ์บนฟอร์ม เช่น 12/05/2017
  paper          text,                   -- ขนาด/แนวกระดาษ (แสดงในทะเบียน)
  used_route     text,                   -- หน้าที่ใช้ฟอร์มนี้
  sig_blocks     jsonb,                  -- รายชื่อช่องลายเซ็น (array of text) — null = ใช้ default ของฟอร์ม
  footer_note    text,                   -- ข้อความท้ายฟอร์มเพิ่มเติม
  logo_url       text,                   -- null = โลโก้ TS default
  notes          text,
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now()
);

alter table doc_forms enable row level security;
create policy "doc_forms_all" on doc_forms for all to authenticated using (true) with check (true);

-- สิทธิ์: ดูทะเบียน = ทุก role · แก้ = doc_forms:manage (document_control + manager, admin bypass)
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/doc-forms', true from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
insert into role_permissions (role, permission_key, allowed) values
  ('manager', 'doc_forms:manage', true), ('document_control', 'doc_forms:manage', true)
on conflict (role, permission_key) do nothing;

-- seed ฟอร์มที่มีในระบบปัจจุบัน (ค่าตรงกับที่ hardcode ในโค้ด ณ 2026-07-20)
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, used_route, sig_blocks) values
  ('ojt', 'FM-HRM-004', 'ใบแจ้งการอบรมสอนงานโดยหัวหน้างาน (ON THE JOB TRAINING)', null, null, 'A4 แนวนอน', '/ojt-training',
    '["ผู้จัดทำ","ระดับจัดการอนุมัติ","ผู้รับทราบ"]'::jsonb),
  ('lpa_report', 'FM-QMR-008', 'Layer Process Audit Report', 'Rev.01', '12/05/2017', 'A3 แนวนอน', '/lpa', null),
  ('lpa_plan', null, 'Layer Process Audit Plan', null, null, 'A4 แนวนอน', '/lpa', null),
  ('mo_report', 'FM-JIG-008', 'ใบแจ้งซ่อม / Work Order (MO)', 'REV.00', '05/12/2025', 'A4 แนวตั้ง', '/mtn-repair', null),
  ('multi_skill', 'FM-PD1-017', 'MULTI SKILL OF OPERATORS (สรุปทั้งไลน์)', null, null, 'A3 แนวนอน', '/skills-report', null),
  ('individual_skill', 'F-PRS-P1-119-0', 'ใบประเมินทักษะความสามารถของพนักงาน (รายบุคคล)', null, null, 'A4 แนวตั้ง', '/skills-report', null)
on conflict (doc_key) do nothing;
