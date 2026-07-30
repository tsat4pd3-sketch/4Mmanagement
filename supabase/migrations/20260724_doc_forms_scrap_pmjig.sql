-- Register the two remaining HARDCODED printed forms into the central Document Master
-- (doc_forms) so the document_control role can manage their form code / rev / effective
-- date from /doc-forms — instead of them being string literals in export code.
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- Phase 1 of consolidating all printed forms under doc_control (per CLAUDE.md rule
-- "ฟอร์มพิมพ์ใหม่ทุกตัวต้อง register เข้า /doc-forms"). Purely additive: the export
-- code keeps its old string as a fallback, so behavior is unchanged until edited here.
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, used_route, notes, is_active) values
  ('scrap_report', 'FM-PD2-002', 'ใบรายงานของเสีย (Scrap Report)', 'Rev.06', '', 'A4 landscape', '/scrap-report', 'export Excel — src/lib/scrapExportExcel.js', true),
  ('pm_jig',       'FM-JIG-003', 'ใบตรวจ PM JIG (PM Inspection)',   'Rev.00', '01/07/2020', 'A4', '/pm-check', 'export Excel+PDF — src/lib/pmExport*.js', true)
on conflict (doc_key) do nothing;
