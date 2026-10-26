-- ทะเบียนเอกสาร: ใบแผนผังองค์กร FM-HRM-I-001(03)   [Main project · ewhdfqwfwofivojtsizn]
-- ที่มา 2026-10-22 · user ส่งใบจริง ORG-001 (ผังใหญ่ Rev.09) + ORG-015 (ผังย่อย HDF Rev.07)
-- แล้วสั่งให้ระบบ export ผังในรูปแบบเดียวกัน → src/lib/orgChartPrint.js
-- 🔴 ทั้ง 2 ใบใช้เลขฟอร์มเดียวกัน ต่างกันแค่ "ขอบเขต/ความลึก" ⇒ ลงทะเบียน doc_key เดียว
-- ย้อนกลับ: delete from public.doc_forms where doc_key = 'org_chart';
insert into public.doc_forms (doc_key, form_code, title, rev, used_route, sig_blocks,
                              paper_size, orientation, layout_locked, is_active, notes)
values ('org_chart', 'FM-HRM-I-001', 'แผนผังองค์กร', '03', '/org-setup',
        '["ผู้จัดทำ","ผู้ตรวจสอบ","ผู้อนุมัติ"]'::jsonb,
        'A3', 'landscape', true, true,
        'ใบเดียวออกได้ 2 แบบ: ผังใหญ่ทั้งโรงงาน (ฝ่าย→ส่วน→แผนก) และผังย่อยรายหน่วย (ลงถึงกลุ่ม + รายชื่อ)')
on conflict (doc_key) do nothing;
