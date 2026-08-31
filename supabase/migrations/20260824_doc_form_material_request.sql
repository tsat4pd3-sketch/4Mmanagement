-- ทะเบียนเอกสาร: ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn)
--
-- กฎ CLAUDE.md: เอกสาร export ใหม่ทุกตัวต้อง register ที่ /doc-forms
--   เลขฟอร์ม/Rev/Effective Date อ่านจากใบกระดาษจริงที่ user ส่งมา (2026-08-24) — seed ค่าจริงได้เลย
--
-- ⚠️ layout_locked = true — ใบนี้ layout ผูกกับ A4 แนวตั้ง (ตาราง 19 แถว + 2 บล็อกลายเซ็น)
--    เปลี่ยนแนวกระดาษแล้วใบพัง

insert into public.doc_forms (doc_key, title, form_code, rev, effective_date,
                              paper, paper_size, orientation, layout_locked, used_route, sig_blocks)
values ('material_request',
        'แบบฟอร์มการขอเบิก/คืนสินค้าคงคลัง',
        'FM-STO-003', 'Rev.01', '01/08/2023',
        'A4 แนวตั้ง', 'A4', 'portrait', true, '/qa?tab=matreq',
        -- 5 ช่องตามใบกระดาษ: ผู้เบิก/คืน 3 ช่อง + ผู้จ่ายสินค้าคงคลัง 2 ช่อง
        -- ⚠️ จำนวนช่องล็อกตาม layout — เปลี่ยนได้เฉพาะข้อความ
        '["จัดทำโดย","อนุมัติโดย","รับ/คืนสินค้าคงคลังโดย","บันทึกโดย","ตรวจสอบโดย"]'::jsonb)
on conflict (doc_key) do nothing;

-- Rollback:
--   delete from public.doc_forms where doc_key = 'material_request';
