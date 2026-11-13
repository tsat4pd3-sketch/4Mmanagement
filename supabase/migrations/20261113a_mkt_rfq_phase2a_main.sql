-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 💼 Marketing Q-neX เฟส 2a — "ปิดสายงานให้ IEC มีของส่งกลับจริง"   ·   project = Main "MAIN" (ewhdfqwfwofivojtsizn)
-- ที่มา: feedback Marketing 12/11 (docs/MARKETING-QNEX-DESIGN.md §10) + คำสั่ง user 13/11 "เริ่มเฟส 2a เลย IEC = engineer_nm ทั้งทีม"
--   1) mkt_rfqs + model_life_years (อายุรุ่น ปี) + job_type (make_to_print / co_design) + assess_requested_at
--   2) mkt_rfq_files    — เอกสารแนบ RFQ แยกชนิด (bucket mkt-files) · ชนิดราคา (cost/quotation) เห็นเฉพาะ MKT
--   3) mkt_rfq_assessments — ใบประเมินความเป็นไปได้ของ IEC (ร่าง process flow · ไลน์อ้างอิง · ความเสี่ยง · ราคาเป้าหมายเป็นไปได้ไหม)
--   4) สิทธิ์ rfq:assess → admin · manager · engineer_nm (IEC ทั้งทีม)
--   5) แจ้งเตือนในแอป rfq_assess_requested (→ engineer_nm) · rfq_assessed (→ marketing)
-- Rollback (ย้อนทั้งหมด · ไม่กระทบเฟส 1):
--   drop table if exists public.mkt_rfq_assessments; drop table if exists public.mkt_rfq_files;
--   alter table public.mkt_rfqs drop column if exists model_life_years, drop column if exists job_type, drop column if exists assess_requested_at;
--   delete from public.role_permissions where permission_key = 'rfq:assess'; delete from public.permission_catalog where resource='rfq' and action='assess';
--   delete from notification_rules where event_key in ('rfq_assess_requested','rfq_assessed');
--   delete from storage.objects where bucket_id='mkt-files'; delete from storage.buckets where id='mkt-files';
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- 1) คอลัมน์ใหม่ของ RFQ (nullable ทั้งหมด = ใบเก่าไม่กระทบ)
alter table public.mkt_rfqs
  add column if not exists model_life_years numeric,                                -- อายุรุ่น (ปี) — ยอดรวมตลอดอายุ = volume/ปี × ปี (utils/mktRfq.js lifetimeVolume)
  add column if not exists job_type text check (job_type in ('make_to_print','co_design')),  -- Q-neX โมดูล 1: ลูกค้าให้แบบมาเลย / ต้องร่วมออกแบบ
  add column if not exists assess_requested_at timestamptz;                         -- MKT กด "ส่งให้ IEC ประเมิน" ครั้งล่าสุด

-- 2) เอกสารแนบ RFQ
create table if not exists public.mkt_rfq_files (
  id            uuid primary key default gen_random_uuid(),
  rfq_id        uuid not null references public.mkt_rfqs(id) on delete cascade,
  -- ชนิดเอกสาร = แกนของ access matrix (Q-neX Data Selection) · เพิ่มชนิดใหม่ต้องเพิ่มที่ utils/mktRfq.js FILE_KINDS ด้วย
  kind          text not null check (kind in ('rfq_letter','drawing','cad','spec','volume','customer_other','assessment','cost','quotation','other')),
  file_url      text not null,
  file_name     text,
  size_bytes    bigint,
  note          text,
  uploaded_by_name text,
  created_at    timestamptz not null default now()
);
create index if not exists mkt_rfq_files_rfq_idx on public.mkt_rfq_files(rfq_id);

-- 3) ใบประเมินความเป็นไปได้ (IEC/CSC) — 1 รอบ = 1 แถว · ขอแก้แบบ/ประเมินใหม่ = รอบถัดไป
create table if not exists public.mkt_rfq_assessments (
  id            uuid primary key default gen_random_uuid(),
  rfq_id        uuid not null references public.mkt_rfqs(id) on delete cascade,
  round         integer not null default 1,
  status        text not null default 'draft' check (status in ('draft','submitted')),
  requested_by_name text,                 -- MKT ที่ส่งมา
  requested_at  timestamptz,
  -- ผลประเมิน
  feasible      text check (feasible in ('yes','no','conditional')),   -- ผลิตได้ / ไม่ได้ / ได้แบบมีเงื่อนไข
  feasible_note text,
  job_type_view text check (job_type_view in ('make_to_print','co_design')),  -- IEC เห็นว่างานนี้เป็นชนิดไหน (ถ้าต่างจากที่ MKT ตั้ง = ต้องคุย)
  process_flow  jsonb not null default '[]'::jsonb,   -- [{op, process, line_name, machine_no, ct_sec, note}] ร่าง flow setup ต่อพาร์ท — input ของ auto-cal เฟส 3
  ref_line_name text,                     -- ไลน์อ้างอิงที่คิดว่าจะผลิต (ทะเบียน production_lines)
  new_investment text,                    -- เครื่อง/อุปกรณ์/แม่พิมพ์ที่ต้องลงทุนเพิ่ม
  risks         text,
  lead_time_note text,                    -- เวลาทำแม่พิมพ์/เตรียมสายการผลิต เทียบ SOP ลูกค้า
  target_price_feasible text check (target_price_feasible in ('yes','no','unknown')),  -- ราคาเป้าหมายลูกค้าเป็นไปได้ไหม (ตอบจากประสบการณ์ · ตัวเลขจริงรอเฟส 3)
  target_price_note text,
  assessed_by_name text,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (rfq_id, round)
);
create index if not exists mkt_rfq_assessments_rfq_idx on public.mkt_rfq_assessments(rfq_id);

-- RLS + GRANT (กฎเหล็ก: ครบทุก cmd ที่ client ใช้ · ตารางใหม่ต้องมี GRANT ด้วยไม่งั้น 401)
alter table public.mkt_rfq_files enable row level security;
alter table public.mkt_rfq_assessments enable row level security;
grant select, insert, update, delete on public.mkt_rfq_files to authenticated;
grant select, insert, update, delete on public.mkt_rfq_assessments to authenticated;

-- ไฟล์: ชนิดราคา (cost/quotation) = MKT เท่านั้น (rfq:edit) · ชนิดอื่นทุกคนที่เข้าหน้าได้ · IEC แนบได้เฉพาะชนิด assessment
drop policy if exists mkt_rfq_files_select on public.mkt_rfq_files;
create policy mkt_rfq_files_select on public.mkt_rfq_files for select to authenticated
  using (kind not in ('cost','quotation') or (select public.has_perm('rfq:edit')));
drop policy if exists mkt_rfq_files_ins on public.mkt_rfq_files;
create policy mkt_rfq_files_ins on public.mkt_rfq_files for insert to authenticated
  with check ((select public.has_perm('rfq:edit')) or (kind = 'assessment' and (select public.has_perm('rfq:assess'))));
drop policy if exists mkt_rfq_files_upd on public.mkt_rfq_files;
create policy mkt_rfq_files_upd on public.mkt_rfq_files for update to authenticated
  using ((select public.has_perm('rfq:edit')) or (kind = 'assessment' and (select public.has_perm('rfq:assess'))))
  with check ((select public.has_perm('rfq:edit')) or (kind = 'assessment' and (select public.has_perm('rfq:assess'))));
drop policy if exists mkt_rfq_files_del on public.mkt_rfq_files;
create policy mkt_rfq_files_del on public.mkt_rfq_files for delete to authenticated
  using ((select public.has_perm('rfq:edit')) or (kind = 'assessment' and (select public.has_perm('rfq:assess'))));

-- ใบประเมิน: อ่านได้ทุกคนที่เข้าหน้า · เปิดรอบ = MKT (rfq:edit) หรือ IEC · กรอก/ส่ง = IEC (rfq:assess) · MKT แก้ได้เฉพาะตอนยังร่าง (เช่นยกเลิกคำขอ) · ห้ามลบ (ประวัติรอบ)
drop policy if exists mkt_rfq_assessments_select on public.mkt_rfq_assessments;
create policy mkt_rfq_assessments_select on public.mkt_rfq_assessments for select to authenticated using (true);
drop policy if exists mkt_rfq_assessments_ins on public.mkt_rfq_assessments;
create policy mkt_rfq_assessments_ins on public.mkt_rfq_assessments for insert to authenticated
  with check ((select public.has_perm('rfq:edit')) or (select public.has_perm('rfq:assess')));
drop policy if exists mkt_rfq_assessments_upd on public.mkt_rfq_assessments;
create policy mkt_rfq_assessments_upd on public.mkt_rfq_assessments for update to authenticated
  using ((select public.has_perm('rfq:assess')) or (status = 'draft' and (select public.has_perm('rfq:edit'))))
  with check ((select public.has_perm('rfq:assess')) or (select public.has_perm('rfq:edit')));

-- updated_at + audit (ท่าเดียวกับเฟส 1)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.mkt_rfq_assessments;
    create trigger trg_set_updated_at before update on public.mkt_rfq_assessments for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.mkt_rfq_assessments;
    create trigger trg_audit after insert or update or delete on public.mkt_rfq_assessments for each row execute function public.fn_audit();
    drop trigger if exists trg_audit on public.mkt_rfq_files;
    create trigger trg_audit after insert or update or delete on public.mkt_rfq_files for each row execute function public.fn_audit();
  end if;
end $$;

-- 4) สิทธิ์ rfq:assess — IEC ทั้งทีม = role engineer_nm (คำสั่ง user 13/11) + admin/manager
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('rfq', 'assess', 'ประเมินความเป็นไปได้ RFQ (IEC)', 'คุณภาพ & วิศวกรรม', 760)
on conflict (resource, action) do nothing;
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'rfq:assess', true from (values ('admin'::user_role), ('manager'::user_role), ('engineer_nm'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = 'rfq:assess');

-- 5) Storage bucket (public URL แบบเดียวกับ npi-files — สุ่ม path เดาไม่ได้ · ชั้นที่คุมว่าใครเห็นคือแถว mkt_rfq_files)
--    ⚠️ known gap: ไฟล์ราคาใน bucket public — เฟส 2b ค่อยย้ายเป็น private + signed URL เมื่อมี helper กลาง
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mkt-files', 'mkt-files', true, 52428800, null)   -- 50MB · รับทุกชนิด (CAD zip/step/dwg)
on conflict (id) do nothing;
drop policy if exists mkt_files_read   on storage.objects;
create policy mkt_files_read   on storage.objects for select using (bucket_id = 'mkt-files');
drop policy if exists mkt_files_write  on storage.objects;
create policy mkt_files_write  on storage.objects for insert to authenticated with check (bucket_id = 'mkt-files');
drop policy if exists mkt_files_update on storage.objects;
create policy mkt_files_update on storage.objects for update to authenticated using (bucket_id = 'mkt-files');
drop policy if exists mkt_files_delete on storage.objects;
create policy mkt_files_delete on storage.objects for delete to authenticated using (bucket_id = 'mkt-files');

-- 6) แจ้งเตือนในแอป (notification_rules · ผู้รับตาม role — ตั้งต่อได้ที่ /notification-config · can_mute=false = งานรอคนลงมือ)
insert into notification_rules (event_key, label, category, is_enabled, sort_order, channel_ids,
  inapp_roles, inapp_match_section, inapp_scope_strict, link, inapp_rollup_min, can_mute)
values
 ('rfq_assess_requested', '📐 RFQ รอ IEC ประเมินความเป็นไปได้', 'marketing', true, 801, '{}',
  '{engineer_nm}', false, false, '/rfq', 60, false),
 ('rfq_assessed',         '✅ IEC ส่งผลประเมิน RFQ กลับแล้ว',   'marketing', true, 802, '{}',
  '{marketing}', false, false, '/rfq', 60, false)
on conflict (event_key) do nothing;

-- ตรวจหลังรัน:
-- select column_name from information_schema.columns where table_name='mkt_rfqs' and column_name in ('model_life_years','job_type','assess_requested_at');
-- select tablename, policyname from pg_policies where tablename in ('mkt_rfq_files','mkt_rfq_assessments') order by 1,2;
-- select role, permission_key from role_permissions where permission_key='rfq:assess' order by 1;
-- select event_key, inapp_roles from notification_rules where event_key like 'rfq_%';
-- select id, public, file_size_limit from storage.buckets where id='mkt-files';
