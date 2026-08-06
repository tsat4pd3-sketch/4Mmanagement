-- ใบตรวจตามมาตรฐาน (QA Inspection Check Sheet) — บันทึก "ผลตรวจจริง" ตามจุดตรวจที่ตั้งไว้
-- Target project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา (คำสั่ง user 2026-08-04): /qa-setup ตั้งมาตรฐานได้ครบ (balloon + สเปค + Rank + ความถี่/n)
-- แต่ `qa_inspection_items` ไม่ถูกอ่านจากหน้าไหนเลยนอกจากหน้า setup เอง → จุดชนิด attribute
-- (GO/NOGO) ไม่มีที่ลงผลเลย ส่วน variable ไปได้ทางเดียวคือกด "ส่งเข้า SPC" (คัดลอกไป
-- qa_characteristics แบบไม่ผูกกลับ) ตารางชุดนี้ปิดช่องว่างนั้น:
--
--   qa_inspection_sheets   1 แถว = 1 ใบตรวจ (พาร์ท + วันงาน + กะ + รอบที่)
--   qa_inspection_results  1 แถว = ผลของ 1 จุดตรวจในใบนั้น (OK/NG + ค่าที่วัดได้)
--
-- snapshot ชื่อจุด/สเปคไว้ในแถวผล เพราะมาตรฐานถูกแก้/ลบทีหลังได้ แต่ผลตรวจย้อนหลัง
-- ต้องอ่านออกเหมือนวันที่ตรวจจริง (หลักเดียวกับ ojt_training_attendees / lpa_audit_answers)

-- ── 1) หัวใบตรวจ ────────────────────────────────────────────────────────────
create table if not exists qa_inspection_sheets (
  id             uuid primary key default gen_random_uuid(),
  part_id        uuid not null references qa_parts(id) on delete cascade,
  part_no        text not null,                 -- snapshot
  part_name      text,                          -- snapshot
  line_name      text,                          -- snapshot (ใช้ scope ตามไลน์/ส่วนงาน)
  work_date      date not null,                 -- วันงาน (ตัด 08:00 ตามกฎ getWorkDate)
  shift          text not null check (shift in ('day','night')),
  round_no       int  not null default 1 check (round_no between 1 and 20),
  stage          text check (stage in ('incoming','setup_first','inprocess','final','patrol')),
  lot_no         text,
  machine_no     text,
  inspector_name text,
  status         text not null default 'open' check (status in ('open','done')),
  result         text check (result in ('pass','fail')),   -- สรุปตอนปิดใบ
  note           text,
  created_by     text,
  created_at     timestamptz not null default now(),
  closed_by      text,
  closed_at      timestamptz,
  -- 1 พาร์ท/วัน/กะ เปิดได้หลายรอบ (ความถี่ เช่น 3 ชิ้น/กะ = ตรวจหลายรอบ) แต่รอบซ้ำไม่ได้
  unique (part_id, work_date, shift, round_no)
);
create index if not exists idx_qa_sheets_lookup on qa_inspection_sheets (work_date desc, part_id);
create index if not exists idx_qa_sheets_line   on qa_inspection_sheets (line_name, work_date desc);

-- ── 2) ผลรายจุดตรวจ ─────────────────────────────────────────────────────────
create table if not exists qa_inspection_results (
  id             uuid primary key default gen_random_uuid(),
  sheet_id       uuid not null references qa_inspection_sheets(id) on delete cascade,
  -- ลบจุดตรวจออกจากมาตรฐานทีหลัง ผลเก่าต้องไม่หาย → set null แล้วอ่านจาก snapshot แทน
  item_id        uuid references qa_inspection_items(id) on delete set null,
  balloon_no     text,                          -- snapshot
  characteristic text,                          -- snapshot
  item_type      text,                          -- snapshot (variable/attribute)
  spec_text      text,                          -- snapshot (สเปคที่ใช้ตัดสินวันนั้น)
  judgement      text not null check (judgement in ('ok','ng','na')),
  values_json    jsonb,                         -- ค่าที่วัดได้ (variable) เก็บเป็น array ตาม n
  qty_checked    int,
  qty_ng         int not null default 0,
  note           text,                          -- บังคับกรอกเมื่อ NG (คุมที่ฝั่งแอป)
  ncr_id         uuid references qa_ncr(id) on delete set null,  -- ใบ NCR ที่เปิดจากจุดนี้
  recorded_by    text,
  recorded_at    timestamptz not null default now(),
  unique (sheet_id, item_id)
);
create index if not exists idx_qa_results_sheet on qa_inspection_results (sheet_id);
create index if not exists idx_qa_results_item  on qa_inspection_results (item_id);

-- ── 3) RLS — pattern เดียวกับ qa_measurements/qa_ncr ────────────────────────
--     อ่าน = ทุก user ที่ login · บันทึก/แก้ = qa:record · ลบ = qa:manage
alter table qa_inspection_sheets  enable row level security;
alter table qa_inspection_results enable row level security;

drop policy if exists qa_sheets_select on qa_inspection_sheets;
create policy qa_sheets_select on qa_inspection_sheets
  for select to authenticated using (true);
drop policy if exists qa_sheets_insert on qa_inspection_sheets;
create policy qa_sheets_insert on qa_inspection_sheets
  for insert to authenticated
  with check ((select has_perm('qa:record')));
drop policy if exists qa_sheets_update on qa_inspection_sheets;
create policy qa_sheets_update on qa_inspection_sheets
  for update to authenticated
  using ((select has_perm('qa:record')))
  with check ((select has_perm('qa:record')));
drop policy if exists qa_sheets_delete on qa_inspection_sheets;
create policy qa_sheets_delete on qa_inspection_sheets
  for delete to authenticated
  using ((select has_perm('qa:manage')));

drop policy if exists qa_results_select on qa_inspection_results;
create policy qa_results_select on qa_inspection_results
  for select to authenticated using (true);
drop policy if exists qa_results_insert on qa_inspection_results;
create policy qa_results_insert on qa_inspection_results
  for insert to authenticated
  with check ((select has_perm('qa:record')));
drop policy if exists qa_results_update on qa_inspection_results;
create policy qa_results_update on qa_inspection_results
  for update to authenticated
  using ((select has_perm('qa:record')))
  with check ((select has_perm('qa:record')));
drop policy if exists qa_results_delete on qa_inspection_results;
create policy qa_results_delete on qa_inspection_results
  for delete to authenticated
  using ((select has_perm('qa:manage')));
