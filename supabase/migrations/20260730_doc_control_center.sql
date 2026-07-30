-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- รวมทะเบียนเอกสารทั้งระบบไว้ที่ doc_forms ที่เดียว (คำสั่ง user 2026-07-30:
-- "ทุกเอกสารในโปรเจคที่ export ได้ ต้องเข้าระบบ doc control และ doc control setup รายละเอียดพวกนี้ได้")
-- 1) เพิ่ม legend + issued_by ให้ doc_forms (ฟีเจอร์จากแผง Changing Point เดิม)
-- 2) ตาราง doc_form_revisions — Revision History ต่อฟอร์ม (generalize จาก document_control_revisions)
-- 3) ย้ายข้อมูล changing_point_control จากทะเบียนเก่า (document_controls) เข้าทะเบียนกลาง
-- 4) seed doc_key ของเอกสาร export ที่เหลือทั้งหมด (audit 2026-07-30)
-- ทะเบียนเก่า document_controls/document_control_revisions คงไว้เป็นประวัติ (ไม่ drop — rollback ได้)

alter table doc_forms add column if not exists legend text;
alter table doc_forms add column if not exists issued_by uuid;

create table if not exists doc_form_revisions (
  id            uuid primary key default gen_random_uuid(),
  doc_key       text not null,
  seq           int  not null default 1,
  record_date   date,
  rev           text,
  issued_date   date,
  description   text,
  responsible   text,
  approved_name text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_doc_form_revisions_key on doc_form_revisions(doc_key, seq);
alter table doc_form_revisions enable row level security;
do $$ begin
  create policy "doc_form_revisions_all" on doc_form_revisions for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- seed เอกสาร export ที่ยังไม่อยู่ในทะเบียน (เลขฟอร์มปล่อยว่างให้ doc_control เติมเอง — ฟอร์มพิมพ์ fallback ค่าเดิม)
insert into doc_forms (doc_key, form_code, title, paper, used_route, sig_blocks) values
  ('changing_point',        null, 'ใบบันทึกการเปลี่ยนแปลง (Changing Point Control Record)', 'A3 แนวนอน',  '/report', null),
  ('cqi15_event_log',       null, 'CQI-15 Event Log Sheet',                                'A4 แนวนอน',  '/event-log', null),
  ('pm_coordination',       null, 'ใบแจ้งแผนประสานงาน PM',                                  'A4 แนวตั้ง', '/pm-coordination',
    '["ผู้จัดทำ (Maintenance)","รับทราบ (Production)"]'::jsonb),
  ('morning_meeting',       null, 'ใบสรุปประชุมแถวเช้า',                                     'A4 แนวตั้ง', '/morning-meeting', null),
  ('ot_booking',            null, 'ใบจองรถ OT',                                             'A4 แนวตั้ง', '/report', null),
  ('report_daily',          null, 'รายงานรายวัน (เช็คชื่อ-PPE)',                              'A4 แนวตั้ง', '/report', null),
  ('report_employee',       null, 'รายงานรายพนักงาน',                                        'A4 แนวตั้ง', '/report', null),
  ('report_station_log',    null, 'รายงาน Log จุดงาน',                                       'A4 แนวตั้ง', '/report', null),
  ('report_period_summary', null, 'รายงานสรุปช่วงเวลา',                                      'A4 แนวตั้ง', '/report', null),
  ('skill_matrix',          null, 'รายงาน Skill Matrix (พิมพ์)',                              'A4 แนวนอน', '/skills-report', null),
  ('skill_pay_summary',     null, 'ใบสรุปค่าฝีมือ',                                          'A4 แนวตั้ง', '/skills-report', null),
  ('attendance_record',     null, 'ใบบันทึกการมาทำงาน',                                      'A4 แนวตั้ง', '/report', null)
on conflict (doc_key) do nothing;

-- ย้ายข้อมูล Changing Point จากทะเบียนเก่า (best-effort — ข้ามถ้าตารางเก่าไม่มี)
do $$
begin
  if to_regclass('public.document_controls') is not null then
    update doc_forms df set
      form_code      = coalesce(dc.doc_no, df.form_code),
      rev            = coalesce(dc.revision, df.rev),
      effective_date = coalesce(dc.effective_date::text, df.effective_date),
      legend         = coalesce(dc.legend, df.legend),
      issued_by      = coalesce(dc.issued_by, df.issued_by)
    from document_controls dc
    where df.doc_key = 'changing_point' and dc.doc_key = 'changing_point_control';
  end if;
  if to_regclass('public.document_control_revisions') is not null then
    insert into doc_form_revisions (doc_key, seq, record_date, rev, issued_date, description, responsible, approved_name)
    select 'changing_point', seq, record_date, rev, issued_date, description, responsible, approved_name
    from document_control_revisions
    where doc_key = 'changing_point_control'
      and not exists (select 1 from doc_form_revisions r where r.doc_key = 'changing_point');
  end if;
end $$;
