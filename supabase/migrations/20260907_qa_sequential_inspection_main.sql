-- ใบตรวจ QA แบบ "ทีละชิ้น" (sequential acceptance) — ผลต่อชิ้น + action หลัง alarm + ผูก 4M
-- Target project: MAIN — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- ที่มา (คำสั่ง user 2026-09-07): หน้างานหยิบชิ้นที่ 1 ไล่ตรวจทุกจุด → ค่อยหยิบชิ้นถัดไป (ไม่ใช่ตรวจจุดเดียว 5 ชิ้น)
--   กฎ: ชิ้นแรกผ่าน = ยอมรับ · ตกสะสม 2 ชิ้นในรอบ = 🚨 alarm ต้องมี action · ผ่านติดกัน 2 = ยอมรับ
--       หลัง action ตกอีกชิ้นเดียว = alarm ซ้ำ · ใช้ทุกสเตจ (First/Middle/End)
--   ตัวเดินกฎ = src/utils/qaSequential.js (single source of truth) — คอลัมน์ seq_* บนใบเป็นแค่ cache
--
--   qa_inspection_pieces   1 แถว = 1 ชิ้นที่หยิบตรวจ (ผ่าน/ตก + จุดที่ตก + disposition ของชิ้นที่ตก)
--   qa_inspection_actions  1 แถว = action ที่ปิด alarm ของรอบนั้น (ฝ่ายผลิตบันทึก · QA คอนเฟิร์มด้วยการตรวจต่อ)
--   ค่าต่อจุดต่อชิ้นยังอยู่ qa_inspection_results.values_json (index = piece_no-1) — ไม่ย้าย
--
-- Rollback (ถอยโค้ดก่อน แล้วค่อยรัน):
--   drop table if exists qa_inspection_actions; drop table if exists qa_inspection_pieces;
--   alter table qa_inspection_sheets drop column if exists seq_round, drop column if exists seq_state, drop column if exists alarm_count;
--   delete from notification_rules where event_key in ('qa_seq_alarm','qa_seq_action');
--   delete from role_permissions where permission_key = 'qa:record_action';
--   delete from permission_catalog where resource = 'qa' and action = 'record_action';

-- ── 1) หัวใบ: cache สถานะของตัวเดินกฎ (ไว้ query/แจ้งเตือน — ความจริงคือ pieces + actions) ──
alter table qa_inspection_sheets
  add column if not exists seq_round   int  not null default 1,
  add column if not exists seq_state   text not null default 'inspecting',
  add column if not exists alarm_count int  not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qa_sheets_seq_state_chk') then
    alter table qa_inspection_sheets add constraint qa_sheets_seq_state_chk
      check (seq_state in ('inspecting','await_action','accepted'));
  end if;
end $$;

-- ── 2) ผลต่อชิ้น ─────────────────────────────────────────────────────────────
create table if not exists qa_inspection_pieces (
  id            uuid primary key default gen_random_uuid(),
  sheet_id      uuid not null references qa_inspection_sheets(id) on delete cascade,
  round_no      int  not null default 1,        -- รอบ (เริ่มรอบใหม่หลังบันทึก action)
  piece_no      int  not null,                  -- เลขชิ้น นับต่อเนื่องทั้งใบ
  result        text not null check (result in ('pass','fail')),
  failed_items  jsonb,                          -- snapshot จุดที่ตก [{item_id, balloon_no, characteristic, spec_text, value, note}]
  disposition   text check (disposition in ('rework','scrap','hold')),  -- บังคับเมื่อ fail (คุมฝั่งแอป)
  remark        text,
  red_bin_id    uuid,                           -- quality_bin_records.id (DR) เมื่อ scrap → ลงถังแดง
  recorded_by   text,
  recorded_at   timestamptz not null default now(),
  unique (sheet_id, piece_no)
);
create index if not exists idx_qa_pieces_sheet on qa_inspection_pieces (sheet_id, piece_no);

-- ── 3) action หลัง alarm ────────────────────────────────────────────────────
create table if not exists qa_inspection_actions (
  id             uuid primary key default gen_random_uuid(),
  sheet_id       uuid not null references qa_inspection_sheets(id) on delete cascade,
  round_no       int  not null,                 -- รอบที่ alarm (action นี้ปิดรอบนั้น → รอบ +1 เริ่ม)
  action_text    text not null,
  action_by      text not null,                 -- ชื่อคนทำ action (ฝ่ายผลิต)
  four_m_log_id  uuid references four_m_logs(id) on delete set null,   -- ถ้าเปิดใบ 4M จาก action นี้
  recorded_by    text,
  recorded_at    timestamptz not null default now(),
  unique (sheet_id, round_no)
);
create index if not exists idx_qa_actions_sheet on qa_inspection_actions (sheet_id);

-- ── 4) RLS — อ่านทุก user ที่ login · pieces เขียน = qa:record · actions เขียน = qa:record_action ──
alter table qa_inspection_pieces  enable row level security;
alter table qa_inspection_actions enable row level security;

drop policy if exists qa_pieces_select on qa_inspection_pieces;
create policy qa_pieces_select on qa_inspection_pieces for select to authenticated using (true);
drop policy if exists qa_pieces_insert on qa_inspection_pieces;
create policy qa_pieces_insert on qa_inspection_pieces for insert to authenticated
  with check ((select has_perm('qa:record')));
drop policy if exists qa_pieces_update on qa_inspection_pieces;
create policy qa_pieces_update on qa_inspection_pieces for update to authenticated
  using ((select has_perm('qa:record'))) with check ((select has_perm('qa:record')));
drop policy if exists qa_pieces_delete on qa_inspection_pieces;
create policy qa_pieces_delete on qa_inspection_pieces for delete to authenticated
  using ((select has_perm('qa:manage')));

drop policy if exists qa_actions_select on qa_inspection_actions;
create policy qa_actions_select on qa_inspection_actions for select to authenticated using (true);
drop policy if exists qa_actions_insert on qa_inspection_actions;
create policy qa_actions_insert on qa_inspection_actions for insert to authenticated
  with check ((select has_perm('qa:record_action')));
drop policy if exists qa_actions_update on qa_inspection_actions;
create policy qa_actions_update on qa_inspection_actions for update to authenticated
  using ((select has_perm('qa:record_action'))) with check ((select has_perm('qa:record_action')));
drop policy if exists qa_actions_delete on qa_inspection_actions;
create policy qa_actions_delete on qa_inspection_actions for delete to authenticated
  using ((select has_perm('qa:manage')));

-- ── 5) สิทธิ์ใหม่ qa:record_action — ฝ่ายผลิตบันทึก action (cross-function กับ QA) ──
insert into permission_catalog (resource, action, label, group_name, sort) values
  ('qa', 'record_action', 'QA: บันทึก action แก้ไขหลัง alarm ใบตรวจ (หัวหน้าไลน์/ฝ่ายผลิต · QA คอนเฟิร์มด้วยการตรวจต่อ)', 'คุณภาพ & วิศวกรรม', 706)
on conflict (resource, action) do nothing;

-- หัวหน้าผลิตทุกระดับ + QA + วิศวกร (ระบุรายชื่อ role ไม่ใช้ enum_range — role ใหม่ให้ admin ติ๊กเพิ่มที่ /permissions)
insert into role_permissions (role, permission_key, allowed)
select r, 'qa:record_action', true
from unnest(array['admin','manager','supervisor','leader','dept_admin','qa','engineer']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- ── 6) Notification rules — ตั้งห้อง (ผลิต + คุณภาพ) ที่ /notification-config ──
insert into notification_rules (event_key, label, category, is_enabled, sort_order)
select 'qa_seq_alarm', 'QA — ใบตรวจตกซ้ำ ต้องแก้ไข (alarm)', 'quality', true, 48
where not exists (select 1 from notification_rules where event_key = 'qa_seq_alarm');

insert into notification_rules (event_key, label, category, is_enabled, sort_order)
select 'qa_seq_action', 'QA — ผลิตบันทึก action แล้ว รอ QA กลับมาตรวจต่อ', 'quality', true, 49
where not exists (select 1 from notification_rules where event_key = 'qa_seq_action');

-- ── ตรวจหลังรัน ──
-- select column_name from information_schema.columns where table_name='qa_inspection_sheets' and column_name like 'seq_%';
-- select tablename, policyname from pg_policies where tablename in ('qa_inspection_pieces','qa_inspection_actions') order by 1,2;
-- select role from role_permissions where permission_key='qa:record_action' order by 1;
-- select event_key, sort_order from notification_rules where event_key like 'qa_seq_%';
