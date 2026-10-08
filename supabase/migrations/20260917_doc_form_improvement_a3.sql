-- ═══════════════════════════════════════════════════════════════════
-- ทะเบียนเอกสาร — ใบ A3 Report ของโปรเจคปรับปรุง (Main project · ewhdfqwfwofivojtsizn)
--
-- กฎ CLAUDE.md / UI-CONVENTIONS §6.6: เอกสาร export ใหม่ทุกตัวต้อง register เข้า /doc-forms
--   ยังไม่มีเลขฟอร์มทางการ = seed form_code null ไว้ก่อน (doc_control เติมเองทีหลัง ไม่ต้องแก้โค้ด)
--
-- layout_locked = false → เปลี่ยนขนาด/แนวกระดาษจากหน้า /doc-forms ได้จริง
--   (ใบนี้เป็นกล่องข้อความ 8 ช่องที่ย่อด้วย zoom ให้จบ 1 หน้าเอง ไม่ใช่ layout ฟอร์มตายตัว)
-- ═══════════════════════════════════════════════════════════════════

insert into public.doc_forms
  (doc_key, form_code, title, rev, paper, paper_size, orientation, layout_locked, used_route, sig_blocks)
values
  ('improvement_a3', null, 'A3 Report — โปรเจคปรับปรุง (Kaizen · PDCA / DMAIC)', null,
   'A3 แนวนอน', 'A3', 'landscape', false, '/improvements',
   '["Approved By","Checked By","Issued By"]'::jsonb)   -- ⚠️ sig_blocks เป็น jsonb ไม่ใช่ text[]
on conflict (doc_key) do nothing;

-- Rollback:
--   delete from public.doc_forms where doc_key = 'improvement_a3';
