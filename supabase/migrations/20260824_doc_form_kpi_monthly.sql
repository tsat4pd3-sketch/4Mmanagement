-- ══ ทะเบียนเอกสาร: สรุป KPI รายเดือน (Main · 2026-08-24) ══
-- ใบพิมพ์ของแท็บ 📑 KPI รายเดือน ใน /dept-dashboard — แทนแพ็คกระดาษรายเดือนที่ปริ้นเซ็นกัน
-- (Internal Defect Report ราย section + OEE รายเดือน) ที่เป็นหลักฐานเบื้องหลังฟอร์ม FM-HRM-6-024
-- ยังไม่มีเลขฟอร์มทางการ → form_code = null (doc_control ตั้งเองที่ /doc-forms ตามกฎทะเบียนเอกสาร)
-- layout_locked = false — รายงานภายในห่อด้วย withDocFoot เปลี่ยนแนวกระดาษได้จริง
insert into public.doc_forms (doc_key, title, form_code, rev, paper, paper_size, orientation, layout_locked, used_route, sig_blocks)
values
  ('kpi_monthly', 'สรุป KPI รายเดือน (OEE · ของเสีย PPM · Cost of defect)', null, null,
   'A4 แนวนอน', 'A4', 'landscape', false, '/dept-dashboard',
   '["Issued","Checked","Approved"]'::jsonb)
on conflict (doc_key) do nothing;
