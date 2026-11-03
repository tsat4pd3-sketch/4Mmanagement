-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ✍️ ลายเซ็นของพนักงาน (employees.signature_url) — 2026-11-03 · ประชุมหน้างาน 02/11 ข้อ C1
-- Project: **Main** (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)
--
-- ทำไม: ใบตรวจที่ export (PM/AM/QA/BBS) ต้องพิมพ์ลายเซ็นผู้ตรวจได้ แม้ผู้ตรวจไม่มีบัญชี login
--       (พนักงานหน้างาน/ผู้รับเหมา) — ตัวตนหน้างาน = รหัสพนักงาน (QR บนบัตร) · โค้ด: src/utils/employeeSignature.js
-- ไฟล์รูป: bucket `signatures` (มีอยู่แล้ว · public read) path `emp/<employee_id>/<ts>.png`
--   โฟลเดอร์ `emp/` แยกจาก `<uid>/` ของลายเซ็นโปรไฟล์ — policy เดิม "Users can manage own signature"
--   เช็ค foldername[1] = auth.uid() จึงไม่ทับกัน
--
-- ✅ backward-compatible: คอลัมน์ใหม่ nullable ไม่มี default · จอทนได้ทั้งก่อน/หลัง apply
--    (ก่อน apply = จอเขียนบอก "ยังไม่เปิดคอลัมน์ลายเซ็น" · ใบพิมพ์เว้นช่องให้เซ็นมือ)
-- ↩️ rollback (ย้อนโค้ดก่อน แล้วค่อยรัน):
--    drop policy if exists "emp_signature_insert" on storage.objects;
--    drop policy if exists "emp_signature_update" on storage.objects;
--    drop policy if exists "emp_signature_delete" on storage.objects;
--    alter table public.employees drop column if exists signature_url;
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table public.employees add column if not exists signature_url text;
comment on column public.employees.signature_url is
  'ลายเซ็นของพนักงาน (public URL ใน bucket signatures/emp/<id>/) — ใช้พิมพ์บนใบตรวจที่ export · ว่าง = เว้นช่องเซ็นมือ (utils/employeeSignature.js)';

-- UPDATE ของแถว employees ใช้ policy เดิม ("Allow authenticated to update employees" · has_perm('employees:edit') ฯลฯ)
-- ⇒ ไม่ต้องเพิ่ม policy ตาราง · GRANT ระดับตารางมีอยู่แล้ว (จอแก้พนักงานใช้อยู่ทุกวัน)

-- ไฟล์ลายเซ็นพนักงาน — คนที่แก้ประวัติพนักงานได้เท่านั้น (คีย์เดียวกับปุ่มบนจอ /operator)
drop policy if exists "emp_signature_insert" on storage.objects;
create policy "emp_signature_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures' and (storage.foldername(name))[1] = 'emp'
    and ((select public.has_perm('employees:edit')) or (select public.has_perm('employees:edit_all_sections')))
  );

drop policy if exists "emp_signature_update" on storage.objects;
create policy "emp_signature_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'signatures' and (storage.foldername(name))[1] = 'emp'
    and ((select public.has_perm('employees:edit')) or (select public.has_perm('employees:edit_all_sections')))
  );

-- 🔴 จอไม่ลบไฟล์เดิม (ใบเก่าอาจอ้าง URL นั้นอยู่ — ดู SignatureModal.jsx) · policy ลบมีไว้ให้เก็บกวาดมือเท่านั้น
drop policy if exists "emp_signature_delete" on storage.objects;
create policy "emp_signature_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'signatures' and (storage.foldername(name))[1] = 'emp'
    and ((select public.has_perm('employees:edit')) or (select public.has_perm('employees:edit_all_sections')))
  );

-- ── ตรวจผล ──
-- select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='employees' and column_name='signature_url';
-- select policyname, cmd from pg_policies where schemaname='storage' and policyname like 'emp_signature_%';
