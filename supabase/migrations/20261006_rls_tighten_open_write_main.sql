-- RLS: ปิดตารางที่ "ใครล็อกอินก็เขียนได้" ให้ตรงคีย์ปุ่มบนจอ (QC audit 2026-10-06)
-- ★ Apply on MAIN (ชื่อในจอ Supabase "MAIN") — project ewhdfqwfwofivojtsizn
--
-- 🔴 ที่เจอ: 6 ตารางมี policy `FOR ALL TO authenticated USING (true) WITH CHECK (true)`
--    = **พนักงานคนไหนก็ได้ที่ล็อกอินเข้าระบบ เขียน/ลบได้ทั้งตาราง** ทั้งที่ปุ่มบนจอถูกล็อกไว้แล้ว
--    (ด่านอยู่ที่ UI ชั้นเดียว — เรียก REST ตรงๆ ก็ผ่าน · กฎเหล็กข้อ 3 + ข้อ 10 "สมมติฐานเรื่องสิทธิ์มีอายุ")
--
--    · doc_forms / doc_form_revisions / doc_form_scopes
--      → ทะเบียนเอกสารควบคุม: **เลขฟอร์ม · Rev · ลายเซ็น · footer · โลโก้ ของทุกใบในระบบ**
--        ใครก็แก้เลขฟอร์มใบที่ยื่น ISO ไปแล้วได้ = ปัญหา document control ของจริง ไม่ใช่แค่เรื่องเทคนิค
--    · factory_map / factory_line_regions → รูปผังโรงงาน + polygon ของทุกไลน์ (ใครก็ลบผังทั้งโรงงานได้)
--    · oee_targets → เป้า OEE ที่ทุกจอใช้ตัดสินสี เขียว/เหลือง/แดง
--
-- ✅ หลักการ: predicate = **union ของคีย์ที่ "เปิดปุ่มเขียน" บนจอจริง** ไม่ใช่คีย์ที่เราคิดว่าควรเป็น
--    (ถ้าแคบกว่าปุ่ม = สร้างบั๊ก "กดแล้วเขียวแต่ไม่บันทึก" ขึ้นมาใหม่เอง — กฎเหล็กข้อ 2)
--      doc_forms*  : doc_forms:manage        (/doc-forms · DocFormsRegistry.jsx:25)
--                  + four_m:manage_docs      (แผงลัดในแท็บ 4M · Report.jsx:1442 → DocumentControlPanel)
--      factory_*   : factory_map:edit        (FactoryMap.jsx:416)
--      oee_targets : oee:set_target          (OEEAnalytics.jsx:310)
--
-- 📖 การอ่าน (SELECT) ยังเปิดให้ทุกคนเหมือนเดิม — **สำคัญมาก**: `loadDocForms()` อ่านทะเบียน
--    ทุกครั้งที่มีใครพิมพ์เอกสาร/export CSV ⇒ ถ้าปิดอ่านด้วย เลขฟอร์มจะหายจากทุกใบทั้งระบบ
--    ⇒ ตารางที่มีแต่ policy `FOR ALL` ต้อง **เพิ่ม policy อ่านก่อน** แล้วค่อยรัดตัว FOR ALL
--
-- ⚠️ ใช้ `alter policy` ไม่ใช่ drop+create — `drop policy` ค้างแล้ว rollback ผ่าน MCP (วัดแล้ว 05/10)
--    และ alter แก้ expression ในที่เดิม ไม่มีช่วงเวลาที่ตารางไม่มี policy (ไม่มีหน้าต่างที่เปิดโล่ง)

-- ── 1. doc_forms + ลูก: เพิ่ม policy อ่านก่อน (idempotent) ───────────────────────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='doc_forms' and policyname='doc_forms_read') then
    create policy doc_forms_read on public.doc_forms for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='doc_form_revisions' and policyname='doc_form_revisions_read') then
    create policy doc_form_revisions_read on public.doc_form_revisions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='doc_form_scopes' and policyname='doc_form_scopes_read') then
    create policy doc_form_scopes_read on public.doc_form_scopes for select to authenticated using (true);
  end if;
end $$;

-- ── 2. รัด policy FOR ALL ให้ตรงคีย์ปุ่ม ───────────────────────────────────────
alter policy doc_forms_all on public.doc_forms
  using       (has_perm('doc_forms:manage') or has_perm('four_m:manage_docs'))
  with check  (has_perm('doc_forms:manage') or has_perm('four_m:manage_docs'));

alter policy doc_form_revisions_all on public.doc_form_revisions
  using       (has_perm('doc_forms:manage') or has_perm('four_m:manage_docs'))
  with check  (has_perm('doc_forms:manage') or has_perm('four_m:manage_docs'));

alter policy doc_form_scopes_all on public.doc_form_scopes
  using       (has_perm('doc_forms:manage') or has_perm('four_m:manage_docs'))
  with check  (has_perm('doc_forms:manage') or has_perm('four_m:manage_docs'));

-- factory_map / factory_line_regions มี policy อ่านแยกอยู่แล้ว (factory_map_read / factory_regions_read)
alter policy factory_map_write on public.factory_map
  using (has_perm('factory_map:edit')) with check (has_perm('factory_map:edit'));

alter policy factory_regions_write on public.factory_line_regions
  using (has_perm('factory_map:edit')) with check (has_perm('factory_map:edit'));

-- oee_targets มี oee_targets_select อยู่แล้ว
alter policy oee_targets_write on public.oee_targets
  using (has_perm('oee:set_target')) with check (has_perm('oee:set_target'));

-- ══ ตรวจผล ══════════════════════════════════════════════════════════════════════
--   select tablename, policyname, cmd, qual
--   from pg_policies where schemaname='public'
--     and tablename in ('doc_forms','doc_form_revisions','doc_form_scopes',
--                       'factory_map','factory_line_regions','oee_targets')
--   order by tablename, cmd;
--   → ทุกตารางต้องมี 2 แถว: SELECT = true · ALL = has_perm(...)
--
-- ══ Rollback (ถ้าหน้าไหนเขียนไม่ได้ทั้งที่ควรได้) ════════════════════════════════
--   คืนเป็นเปิดโล่งเฉพาะตารางนั้น เช่น
--     alter policy oee_targets_write on public.oee_targets using (true) with check (true);
--   แล้วมาไล่ดูว่าปุ่มนั้นใช้คีย์อะไร (`can(...)` ในหน้า) แล้วเติมคีย์นั้นเข้า predicate
--   — **ห้ามแก้ด้วยการคืนเป็น true ถาวร** policy อ่านที่เพิ่มใหม่ปล่อยไว้ได้ ไม่กระทบอะไร
