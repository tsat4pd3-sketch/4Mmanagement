-- ══ เพิ่ม 'improvement' เข้า vocabulary ref_kind (Main · 2026-08-19) ══
-- ลูปปิด Improvement → PE: โปรเจคปรับปรุงที่เปลี่ยนวิธีการ/จิ๊ก/พารามิเตอร์ = process change
-- ที่ต้องทบทวน PFMEA/Control Plan เหมือน 8D — เสนอคำขอแก้เอกสาร PE ตอนปิดจ๊อบ (soft gate)
-- กฎเดิม: ref_kind ใช้ vocabulary "ชุดเดียว" ร่วมกันทั้ง pe_change_requests + pe_doc_revisions
-- → ขยายต้องขยายทั้ง 2 ตารางพร้อมกันในไฟล์เดียว ห้ามขยายข้างเดียว
--
-- rollback: alter table ... drop constraint ...; add constraint เดิม (ตัด 'improvement' ออก)
--           ก่อน rollback ต้องไม่มีแถว ref_kind='improvement' ค้าง (ตรวจ: select count(*) ...)

alter table public.pe_change_requests drop constraint if exists pe_change_requests_ref_kind_check;
alter table public.pe_change_requests add constraint pe_change_requests_ref_kind_check
  check (ref_kind in ('capa','ncr','claim','defect','downtime','mtn','audit','improvement','other'));

alter table public.pe_doc_revisions drop constraint if exists pe_doc_revisions_ref_kind_check;
alter table public.pe_doc_revisions add constraint pe_doc_revisions_ref_kind_check
  check (ref_kind is null or ref_kind in ('capa','ncr','claim','defect','downtime','mtn','audit','improvement','other'));
