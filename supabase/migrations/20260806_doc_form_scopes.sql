-- ══════════════════════════════════════════════════════════════════════════════════════
-- Main project (ewhdfqwfwofivojtsizn) — ทะเบียนเอกสาร เฟส 3 (2026-08-06 · คำสั่ง user)
-- 3 เรื่องที่ขอ:
--   1) ทดลอง export PDF จากหน้าทะเบียนได้เลย (ไม่ต้องไปหาใบจริงมาพิมพ์ทดสอบ)  → ฝั่ง UI ล้วน
--   2) เลือก portrait/landscape ได้                                            → paper_size + orientation
--   3) แยก "ชื่อคนเซ็นแต่ละจุด" ตามส่วนงาน/หน่วยงาน                            → doc_form_scopes
--
-- โมเดลข้อ 3 ใช้ pattern เดิมที่ระบบใช้อยู่แล้ว (lpa_questions.line_name null = common):
--   doc_forms   = ฐานกลางของทั้งบริษัท (เลขฟอร์ม/Rev/ป้ายช่องเซ็นมาตรฐาน)
--   doc_form_scopes = "ทับเฉพาะส่วนงานนี้" — ไม่มีแถว = ใช้ฐานกลาง
-- ห้ามแตกทะเบียนเอกสารเป็นชุดต่อแผนก (เลขฟอร์ม/Rev ต้องเป็นของบริษัท ไม่ใช่ของแผนก)
-- ══════════════════════════════════════════════════════════════════════════════════════

-- ── 2) ขนาด/แนวกระดาษแบบมีโครงสร้าง (เดิม `paper` เป็น free text แสดงในทะเบียนเฉยๆ) ──
alter table doc_forms add column if not exists paper_size   text;     -- A4 / A3 / Letter
alter table doc_forms add column if not exists orientation  text;     -- portrait / landscape
-- ⚠️ layout_locked = ฟอร์มที่ layout ออกแบบมาตายตัวกับแนวกระดาษ (ตาราง 31 คอลัมน์วัน ฯลฯ)
--    เปลี่ยนแนวแล้วใบพัง → UI ล็อกไม่ให้แก้ + อธิบายเหตุผล  **ห้ามปล่อยให้กดแก้แล้วเงียบ**
--    false = รายงานภายในที่ห่อด้วย withDocFoot() ล้วน — เปลี่ยนแนวได้จริง มีผลทันที
alter table doc_forms add column if not exists layout_locked boolean not null default true;

-- backfill จาก free text เดิม (ยังคงคอลัมน์ paper ไว้เป็นข้อความอธิบายในทะเบียน)
update doc_forms set
  paper_size  = coalesce(paper_size, case when paper ilike '%a3%' then 'A3'
                                          when paper ilike '%letter%' then 'Letter' else 'A4' end),
  orientation = coalesce(orientation, case when paper ilike '%นอน%' or paper ilike '%landscape%'
                                           then 'landscape' else 'portrait' end)
where paper is not null;

-- รายงานภายในที่ไม่มี layout ฟอร์มทางการ = เลือกแนวกระดาษได้จริง
update doc_forms set layout_locked = false where doc_key in (
  'report_daily', 'report_employee', 'report_station_log', 'report_period_summary',
  'morning_meeting', 'ot_booking', 'spare_part_list', 'rack_qr_labels', 'qr_label',
  'daily_report_export'
);

-- ── 3) override รายส่วนงาน ──
create table if not exists doc_form_scopes (
  id          uuid primary key default gen_random_uuid(),
  doc_key     text not null references doc_forms(doc_key) on delete cascade,
  -- ส่วนงาน = org_nodes.code (kind='section') เช่น PD1 / MTN / QA — ตัวกำหนดว่าใบนี้ใช้ชุดไหน
  section     text not null,
  -- ป้ายช่องเซ็น (ต้องมีจำนวนช่องเท่าฐาน — layout ฟอร์มตายตัว) · null = ใช้ป้ายฐาน
  sig_blocks  jsonb,
  -- ชื่อผู้เซ็นประจำแต่ละช่อง (index ตรงกับ sig_blocks) · ช่องที่เว้นว่าง = ใบพิมพ์เว้นให้เซ็นสด
  sig_names   jsonb,
  footer_note text,
  legend      text,
  issued_by   uuid,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (doc_key, section)
);
create index if not exists idx_doc_form_scopes_key on doc_form_scopes(doc_key);

alter table doc_form_scopes enable row level security;
-- policy เดียวกับ doc_forms/doc_form_revisions (authenticated ทำได้ · คุมสิทธิ์จริงที่ UI ผ่าน
-- doc_forms:manage) — ตั้ง policy แน่นกว่าตารางแม่ไม่ได้ช่วยอะไร แถม admin ที่ไม่มีแถวใน
-- role_permissions จะโดนล็อกตัวเอง (admin bypass อยู่ในโค้ด ไม่ได้อยู่ในตาราง)
do $$ begin
  create policy "doc_form_scopes_all" on doc_form_scopes for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
