-- Register the PM JIG inspection form (FM-JIG-003) into the central Document Master
-- (doc_forms) so the document_control role can manage its form code / rev / effective
-- date from /doc-forms — instead of the string literals hardcoded in pmExport*.js.
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- (scrap_report is seeded separately in 20260724_doc_form_scrap_report.sql — not here, to avoid a duplicate.)
-- Purely additive: export code keeps its old string as fallback, so behavior is unchanged until edited here.
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, used_route, notes, is_active) values
  ('pm_jig', 'FM-JIG-003', 'ใบตรวจ PM JIG (PM Inspection)', 'Rev.00', '01/07/2020', 'A4', '/pm-check', 'export Excel+PDF — src/lib/pmExport*.js', true)
on conflict (doc_key) do nothing;
